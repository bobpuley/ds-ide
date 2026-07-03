#include "core_audio_device.h"
#include <cstring>

#ifdef __APPLE__
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <mach/mach_time.h>
#include <algorithm>
#include <cstdlib>
#include <vector>
#include <atomic>
#include <functional>

namespace daisy_emu {

static double compute_mach_ns_per_tick() {
    mach_timebase_info_data_t info;
    kern_return_t kr = mach_timebase_info(&info);
    if (kr != KERN_SUCCESS || info.denom == 0)
        return 1.0;  // fallback: treat ticks as nanoseconds
    return static_cast<double>(info.numer) / static_cast<double>(info.denom);
}

// Returns the maximum frame count `device` can ever be asked to deliver in a
// single I/O cycle (queried via kAudioDevicePropertyBufferFrameSizeRange), or
// `fallback` if the device is unknown or the property query fails (FR-RTS-1).
static UInt32 query_max_buffer_frames(AudioDeviceID device, UInt32 fallback) {
    if (device == kAudioDeviceUnknown) return fallback;
    AudioValueRange range{};
    UInt32 sz = sizeof(range);
    AudioObjectPropertyAddress a{kAudioDevicePropertyBufferFrameSizeRange,
                                 kAudioObjectPropertyScopeGlobal,
                                 kAudioObjectPropertyElementMain};
    if (AudioObjectGetPropertyData(device, &a, 0, nullptr, &sz, &range) != noErr)
        return fallback;
    UInt32 maxFrames = static_cast<UInt32>(range.mMaximum);
    return maxFrames > fallback ? maxFrames : fallback;
}

struct CoreAudioDevice::Impl {
    AudioUnit unit{nullptr};
    ProcessFn processBlock;
    uint32_t  bufferSize{256};
    uint32_t  sampleRate{48000};
    uint32_t  inputChannels{1};
    // Stored before AudioOutputUnitStart so the RT thread reads a stable value
    // without races against the construction thread (FR-QA-19).
    double    mach_ns_per_tick{1.0};

    // Input buffer list — allocated after querying hardware format, freed in stop().
    // Null in output-only mode.
    AudioBufferList* inputBufList{nullptr};
    // Frame capacity inputBufList's channel buffers were malloc'd for (FR-RTS-1).
    // Sized from the hardware's maximum deliverable frame count, not bufferSize;
    // the render callback clamps to this so it can never write past the allocation.
    UInt32 inputBufCapacityFrames{0};

    // Pre-allocated render callback buffers (AC-38): sized in start(), reused each
    // callback to avoid per-invocation heap allocation on the real-time thread.
    std::vector<float> in_interleaved;   // stereo-interleaved input, sized bufferSize*2
    std::vector<float> out_interleaved;  // stereo-interleaved output, sized bufferSize*2

    // Work buffers for output-only mode (avoid per-callback allocation).
    std::vector<float> silentInput;  // zeroed, sized bufferSize*2
    std::vector<float> workOut;      // interleaved output, sized bufferSize*2

    std::atomic<uint32_t> xruns{0};
    std::atomic<float>    latencyMs{0.f};

    static OSStatus renderCallback(void*                       inRefCon,
                                   AudioUnitRenderActionFlags* ioActionFlags,
                                   const AudioTimeStamp*       inTimeStamp,
                                   UInt32                      /*inBusNumber*/,
                                   UInt32                      inNumberFrames,
                                   AudioBufferList*            ioData) {
        Impl* self = static_cast<Impl*>(inRefCon);

        // Clamp to inputBufList's allocated capacity (FR-RTS-1). inputBufList is
        // sized in start() for the hardware's maximum deliverable frame count, so
        // this is normally a no-op; it exists as a defense-in-depth backstop
        // against writing past the malloc'd buffer if CoreAudio ever delivers
        // more frames than were queried at start() time.
        const UInt32 frames32 = std::min(inNumberFrames, self->inputBufCapacityFrames);

        // Reset input buffer sizes each callback (AudioUnitRender may update them).
        for (UInt32 b = 0; b < self->inputBufList->mNumberBuffers; ++b) {
            self->inputBufList->mBuffers[b].mDataByteSize =
                static_cast<UInt32>(frames32 * sizeof(float));
            std::memset(self->inputBufList->mBuffers[b].mData, 0,
                        frames32 * sizeof(float));
        }

        // Pull live input from AUHAL input bus.
        AudioUnitRender(self->unit, ioActionFlags, inTimeStamp, 1 /*input bus*/,
                        frames32, self->inputBufList);

        // Build stereo-interleaved input buffer from hardware input (handles mono→stereo).
        // Use pre-allocated member buffers — no heap allocation on the RT thread (AC-38).
        const size_t frames = static_cast<size_t>(frames32);
        if (self->in_interleaved.size() < frames * 2)
            self->in_interleaved.assign(frames * 2, 0.f);
        else
            std::fill(self->in_interleaved.begin(),
                      self->in_interleaved.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);
        if (self->out_interleaved.size() < frames * 2)
            self->out_interleaved.assign(frames * 2, 0.f);
        else
            std::fill(self->out_interleaved.begin(),
                      self->out_interleaved.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);

        if (self->inputChannels >= 2 && self->inputBufList->mNumberBuffers >= 2) {
            const float* inL = static_cast<const float*>(self->inputBufList->mBuffers[0].mData);
            const float* inR = static_cast<const float*>(self->inputBufList->mBuffers[1].mData);
            for (size_t i = 0; i < frames; ++i) {
                self->in_interleaved[2 * i]     = inL[i];
                self->in_interleaved[2 * i + 1] = inR[i];
            }
        } else if (self->inputBufList->mNumberBuffers >= 1) {
            // Mono input — duplicate to both channels
            const float* inMono = static_cast<const float*>(self->inputBufList->mBuffers[0].mData);
            for (size_t i = 0; i < frames; ++i) {
                self->in_interleaved[2 * i]     = inMono[i];
                self->in_interleaved[2 * i + 1] = inMono[i];
            }
        }

        // Run the effect.
        uint64_t t_start = mach_absolute_time();
        self->processBlock(self->in_interleaved.data(), self->out_interleaved.data(), frames);
        uint64_t t_end = mach_absolute_time();

        double elapsed_ms = static_cast<double>(t_end - t_start) * self->mach_ns_per_tick / 1e6;
        double budget_ms  = static_cast<double>(inNumberFrames) /
                            static_cast<double>(self->sampleRate) * 1000.0;
        if (elapsed_ms > budget_ms) {
            self->xruns.fetch_add(1, std::memory_order_relaxed);
        }
        self->latencyMs.store(static_cast<float>(budget_ms * 2.0), std::memory_order_relaxed);

        // Deinterleave effect output → CoreAudio non-interleaved buffers. If the
        // FR-RTS-1 backstop clamped frames32 below inNumberFrames, zero the
        // unfilled tail rather than leaving it unwritten.
        if (ioData->mNumberBuffers >= 2) {
            float* outL = static_cast<float*>(ioData->mBuffers[0].mData);
            float* outR = static_cast<float*>(ioData->mBuffers[1].mData);
            for (size_t i = 0; i < frames; ++i) {
                outL[i] = self->out_interleaved[2 * i];
                outR[i] = self->out_interleaved[2 * i + 1];
            }
            for (UInt32 i = frames32; i < inNumberFrames; ++i) { outL[i] = 0.f; outR[i] = 0.f; }
        } else if (ioData->mNumberBuffers == 1) {
            float* outMono = static_cast<float*>(ioData->mBuffers[0].mData);
            for (size_t i = 0; i < frames; ++i) {
                outMono[i] = self->out_interleaved[2 * i];
            }
            for (UInt32 i = frames32; i < inNumberFrames; ++i) outMono[i] = 0.f;
        }

        return noErr;
    }

    // Output-only render callback: no AudioUnitRender call, no live input.
    // processBlock receives a pre-zeroed input buffer; the caller generates its own input.
    static OSStatus renderCallbackOutputOnly(void*                       inRefCon,
                                             AudioUnitRenderActionFlags* /*ioActionFlags*/,
                                             const AudioTimeStamp*       /*inTimeStamp*/,
                                             UInt32                      /*inBusNumber*/,
                                             UInt32                      inNumberFrames,
                                             AudioBufferList*            ioData) {
        Impl* self = static_cast<Impl*>(inRefCon);
        const size_t frames = static_cast<size_t>(inNumberFrames);

        // Grow work buffers if the hardware gives us more frames than expected.
        if (self->silentInput.size() < frames * 2)
            self->silentInput.assign(frames * 2, 0.f);
        if (self->workOut.size() < frames * 2)
            self->workOut.resize(frames * 2, 0.f);

        uint64_t t_start = mach_absolute_time();
        self->processBlock(self->silentInput.data(), self->workOut.data(), frames);
        uint64_t t_end = mach_absolute_time();

        double elapsed_ms = static_cast<double>(t_end - t_start) * self->mach_ns_per_tick / 1e6;
        double budget_ms  = static_cast<double>(inNumberFrames) /
                            static_cast<double>(self->sampleRate) * 1000.0;
        if (elapsed_ms > budget_ms)
            self->xruns.fetch_add(1, std::memory_order_relaxed);

        // Deinterleave effect output → CoreAudio non-interleaved buffers.
        if (ioData->mNumberBuffers >= 2) {
            float* outL = static_cast<float*>(ioData->mBuffers[0].mData);
            float* outR = static_cast<float*>(ioData->mBuffers[1].mData);
            for (size_t i = 0; i < frames; ++i) {
                outL[i] = self->workOut[2 * i];
                outR[i] = self->workOut[2 * i + 1];
            }
        } else if (ioData->mNumberBuffers == 1) {
            float* outMono = static_cast<float*>(ioData->mBuffers[0].mData);
            for (size_t i = 0; i < frames; ++i)
                outMono[i] = self->workOut[2 * i];
        }

        return noErr;
    }
};

CoreAudioDevice::CoreAudioDevice() {}

CoreAudioDevice::~CoreAudioDevice() {
    stop();  // stop() already calls delete impl_ and sets impl_ = nullptr (AC-50)
}

bool CoreAudioDevice::start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    if (running_) stop();

    impl_ = new Impl();
    impl_->sampleRate   = sampleRate;
    impl_->bufferSize   = bufferSize;
    impl_->processBlock = std::move(processBlock);

    // Find the AUHAL component.
    AudioComponentDescription desc{};
    desc.componentType         = kAudioUnitType_Output;
    desc.componentSubType      = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (!comp) { delete impl_; impl_ = nullptr; return false; }

    if (AudioComponentInstanceNew(comp, &impl_->unit) != noErr) {
        delete impl_; impl_ = nullptr; return false;
    }

    // Enable output on bus 0, enable input on bus 1.
    UInt32 one = 1, zero = 0;
    AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Output, 0, &one, sizeof(one));
    AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Input,  1, &one, sizeof(one));
    // Disable output side of input bus (required for duplex AUHAL).
    AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Output, 1, &zero, sizeof(zero));

    // Explicitly set the default INPUT device on bus 1 so we get the microphone,
    // not the output device's (possibly absent) input channel. Captured at
    // function scope so its buffer-frame-size range can be queried below (FR-RTS-1).
    AudioDeviceID defaultInputDevice = kAudioDeviceUnknown;
    {
        UInt32 sz = sizeof(defaultInputDevice);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultInputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultInputDevice);
        if (defaultInputDevice != kAudioDeviceUnknown) {
            AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_CurrentDevice,
                                 kAudioUnitScope_Global, 1, &defaultInputDevice, sizeof(defaultInputDevice));
        }
    }

    // Set OUTPUT stream format: non-interleaved stereo float32.
    AudioStreamBasicDescription outFmt{};
    outFmt.mSampleRate       = static_cast<Float64>(sampleRate);
    outFmt.mFormatID         = kAudioFormatLinearPCM;
    outFmt.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsNonInterleaved
                             | kAudioFormatFlagIsPacked;
    outFmt.mBytesPerPacket   = sizeof(float);
    outFmt.mFramesPerPacket  = 1;
    outFmt.mBytesPerFrame    = sizeof(float);
    outFmt.mChannelsPerFrame = 2;
    outFmt.mBitsPerChannel   = 32;
    AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_StreamFormat,
                         kAudioUnitScope_Input, 0, &outFmt, sizeof(outFmt));

    // Query the INPUT hardware's ACTUAL stream format (don't force it — mono mics are common).
    AudioStreamBasicDescription inFmt{};
    UInt32 inFmtSize = sizeof(inFmt);
    AudioUnitGetProperty(impl_->unit, kAudioUnitProperty_StreamFormat,
                         kAudioUnitScope_Output, 1, &inFmt, &inFmtSize);
    // If query failed, default to the same as output format.
    if (inFmt.mSampleRate == 0.0) inFmt = outFmt;
    impl_->inputChannels = inFmt.mChannelsPerFrame > 0 ? inFmt.mChannelsPerFrame : 1;

    // Set hardware buffer size on the output device. Captured at function scope
    // so its buffer-frame-size range can be queried below (FR-RTS-1).
    AudioDeviceID defaultOutputDevice = kAudioDeviceUnknown;
    {
        UInt32 sz = sizeof(defaultOutputDevice);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultOutputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultOutputDevice);
        if (defaultOutputDevice != kAudioDeviceUnknown) {
            UInt32 hwBuf = static_cast<UInt32>(bufferSize);
            AudioObjectPropertyAddress ba{kAudioDevicePropertyBufferFrameSize,
                                          kAudioObjectPropertyScopeGlobal,
                                          kAudioObjectPropertyElementMain};
            AudioObjectSetPropertyData(defaultOutputDevice, &ba, 0, nullptr, sizeof(hwBuf), &hwBuf);
        }
    }

    // Query the maximum frame count CoreAudio can ever deliver to the render
    // callback on either device, so inputBufList is sized for the worst case
    // instead of just the requested bufferSize (FR-RTS-1). A device that clamps
    // a small requested bufferSize up to a larger hardware minimum would
    // otherwise cause the render callback to memset/AudioUnitRender past the
    // malloc'd buffer.
    UInt32 maxInputFrames = static_cast<UInt32>(bufferSize);
    maxInputFrames = query_max_buffer_frames(defaultInputDevice, maxInputFrames);
    maxInputFrames = query_max_buffer_frames(defaultOutputDevice, maxInputFrames);
    impl_->inputBufCapacityFrames = maxInputFrames;

    // Size RT-callback-visible interleaved buffers from the queried maximum
    // frame count before starting the audio unit (FR-RTS-2) — the render
    // callback may begin executing the instant AudioOutputUnitStart() returns,
    // so these must never be resized while the unit is running.
    impl_->in_interleaved.assign(static_cast<size_t>(maxInputFrames) * 2, 0.f);
    impl_->out_interleaved.assign(static_cast<size_t>(maxInputFrames) * 2, 0.f);

    // Allocate input buffer list based on the actual hardware channel count.
    size_t dataBytes = static_cast<size_t>(maxInputFrames) * sizeof(float);
    uint32_t nBufs = impl_->inputChannels;
    impl_->inputBufList = static_cast<AudioBufferList*>(
        std::malloc(sizeof(AudioBufferList) + (nBufs - 1) * sizeof(AudioBuffer)));
    if (!impl_->inputBufList) { stop(); return false; }  // AC-41: null check
    impl_->inputBufList->mNumberBuffers = 0;
    for (uint32_t ch = 0; ch < nBufs; ++ch) {
        void* buf = std::malloc(dataBytes);
        if (!buf) { stop(); return false; }  // AC-41: null check — stop() frees already-allocated buffers
        std::memset(buf, 0, dataBytes);
        impl_->inputBufList->mBuffers[ch].mNumberChannels = 1;
        impl_->inputBufList->mBuffers[ch].mDataByteSize   = static_cast<UInt32>(dataBytes);
        impl_->inputBufList->mBuffers[ch].mData           = buf;
        impl_->inputBufList->mNumberBuffers = ch + 1;  // track how many are valid for stop()
    }

    // Set the output render callback.
    AURenderCallbackStruct cb{};
    cb.inputProc       = Impl::renderCallback;
    cb.inputProcRefCon = impl_;
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input, 0, &cb, sizeof(cb)) != noErr) {
        stop(); return false;
    }

    impl_->mach_ns_per_tick = compute_mach_ns_per_tick();

    // RT-callback-visible buffers were already sized above from the queried
    // maximum frame count, before this call (FR-RTS-2) — no post-start resize.
    if (AudioUnitInitialize(impl_->unit) != noErr) { stop(); return false; }
    if (AudioOutputUnitStart(impl_->unit) != noErr) { stop(); return false; }

    running_ = true;
    return true;
}

bool CoreAudioDevice::start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    if (running_) stop();

    impl_ = new Impl();
    impl_->sampleRate   = sampleRate;
    impl_->bufferSize   = bufferSize;
    impl_->processBlock = std::move(processBlock);

    AudioComponentDescription desc{};
    desc.componentType         = kAudioUnitType_Output;
    desc.componentSubType      = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (!comp) { delete impl_; impl_ = nullptr; return false; }

    if (AudioComponentInstanceNew(comp, &impl_->unit) != noErr) {
        delete impl_; impl_ = nullptr; return false;
    }

    // Output-only: enable bus 0 (output), disable bus 1 (input — no mic needed).
    UInt32 one = 1, zero = 0;
    AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Output, 0, &one,  sizeof(one));
    AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Input,  1, &zero, sizeof(zero));

    // OUTPUT stream format: non-interleaved stereo float32.
    AudioStreamBasicDescription outFmt{};
    outFmt.mSampleRate       = static_cast<Float64>(sampleRate);
    outFmt.mFormatID         = kAudioFormatLinearPCM;
    outFmt.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsNonInterleaved
                             | kAudioFormatFlagIsPacked;
    outFmt.mBytesPerPacket   = sizeof(float);
    outFmt.mFramesPerPacket  = 1;
    outFmt.mBytesPerFrame    = sizeof(float);
    outFmt.mChannelsPerFrame = 2;
    outFmt.mBitsPerChannel   = 32;
    AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_StreamFormat,
                         kAudioUnitScope_Input, 0, &outFmt, sizeof(outFmt));

    // Request the preferred hardware buffer size on the default output device,
    // then size RT-callback-visible work buffers from the queried maximum frame
    // count before starting the audio unit (FR-RTS-2) — no resize once the
    // callback may be running.
    AudioDeviceID defaultOutputDevice = kAudioDeviceUnknown;
    {
        UInt32 sz = sizeof(defaultOutputDevice);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultOutputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultOutputDevice);
        if (defaultOutputDevice != kAudioDeviceUnknown) {
            UInt32 hwBuf = static_cast<UInt32>(bufferSize);
            AudioObjectPropertyAddress ba{kAudioDevicePropertyBufferFrameSize,
                                          kAudioObjectPropertyScopeGlobal,
                                          kAudioObjectPropertyElementMain};
            AudioObjectSetPropertyData(defaultOutputDevice, &ba, 0, nullptr, sizeof(hwBuf), &hwBuf);
        }
    }
    UInt32 maxOutFrames = query_max_buffer_frames(defaultOutputDevice, static_cast<UInt32>(bufferSize));
    impl_->silentInput.assign(static_cast<size_t>(maxOutFrames) * 2, 0.f);
    impl_->workOut.resize(static_cast<size_t>(maxOutFrames) * 2, 0.f);

    AURenderCallbackStruct cb{};
    cb.inputProc       = Impl::renderCallbackOutputOnly;
    cb.inputProcRefCon = impl_;
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input, 0, &cb, sizeof(cb)) != noErr) {
        stop(); return false;
    }

    impl_->mach_ns_per_tick = compute_mach_ns_per_tick();

    // RT-callback-visible buffers were already sized above from the queried
    // maximum frame count, before this call (FR-RTS-2) — no post-start resize.
    if (AudioUnitInitialize(impl_->unit) != noErr) { stop(); return false; }
    if (AudioOutputUnitStart(impl_->unit) != noErr) { stop(); return false; }

    running_ = true;
    return true;
}

void CoreAudioDevice::stop() {
    if (impl_ && impl_->unit) {
        // AudioOutputUnitStop drains any in-flight render callbacks before returning
        // (documented Apple guarantee), so impl_ member buffers captured by reference
        // in the callback are safe to free immediately after this call (AC-51).
        AudioOutputUnitStop(impl_->unit);
        AudioUnitUninitialize(impl_->unit);
        AudioComponentInstanceDispose(impl_->unit);
        impl_->unit = nullptr;
    }
    if (impl_ && impl_->inputBufList) {
        for (UInt32 b = 0; b < impl_->inputBufList->mNumberBuffers; ++b) {
            std::free(impl_->inputBufList->mBuffers[b].mData);
        }
        std::free(impl_->inputBufList);
        impl_->inputBufList = nullptr;
    }
    delete impl_;
    impl_ = nullptr;
    running_ = false;
}

uint32_t CoreAudioDevice::drainXruns() {
    if (!impl_) return 0;
    return impl_->xruns.exchange(0, std::memory_order_relaxed);
}

float CoreAudioDevice::lastLatencyMs() const {
    if (!impl_) return 0.f;
    return impl_->latencyMs.load(std::memory_order_relaxed);
}

} // namespace daisy_emu

#else  // !__APPLE__

namespace daisy_emu {

CoreAudioDevice::CoreAudioDevice() {}
CoreAudioDevice::~CoreAudioDevice() { stop(); }

bool CoreAudioDevice::start(uint32_t, uint32_t, ProcessFn) { return false; }
bool CoreAudioDevice::start_output_only(uint32_t, uint32_t, ProcessFn) { return false; }

void CoreAudioDevice::stop() { running_ = false; }

uint32_t CoreAudioDevice::drainXruns() { return 0; }
float    CoreAudioDevice::lastLatencyMs() const { return 0.f; }

} // namespace daisy_emu

#endif // __APPLE__
