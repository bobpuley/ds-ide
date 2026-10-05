#include "core_audio_device.h"
#include <cstring>

#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <algorithm>
#include <cstdlib>
#include <vector>
#include <atomic>
#include <chrono>
#include <cmath>
#include <functional>

namespace daisy_emu {

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

// The buffer size `device` is currently running with, in frames at
// `streamRate`, or 0 if unknown (FR-WIN-AUD-6). kAudioDevicePropertyBufferFrameSize
// is in device-rate frames; when the device runs at another rate (e.g. a 16 kHz
// Bluetooth headset) the AUHAL resamples and the callback sees proportionally
// more frames per I/O cycle, which is what the caller compares against.
static uint32_t query_buffer_frames(AudioDeviceID device, uint32_t streamRate) {
    if (device == kAudioDeviceUnknown) return 0;
    UInt32 frames = 0;
    UInt32 sz = sizeof(frames);
    AudioObjectPropertyAddress a{kAudioDevicePropertyBufferFrameSize,
                                 kAudioObjectPropertyScopeGlobal,
                                 kAudioObjectPropertyElementMain};
    if (AudioObjectGetPropertyData(device, &a, 0, nullptr, &sz, &frames) != noErr) return 0;
    Float64 deviceRate = 0.0;
    sz = sizeof(deviceRate);
    AudioObjectPropertyAddress r{kAudioDevicePropertyNominalSampleRate,
                                 kAudioObjectPropertyScopeGlobal,
                                 kAudioObjectPropertyElementMain};
    if (AudioObjectGetPropertyData(device, &r, 0, nullptr, &sz, &deviceRate) != noErr || deviceRate <= 0.0)
        return frames;
    return static_cast<uint32_t>(std::lround(frames * static_cast<double>(streamRate) / deviceRate));
}

// Wall-clock time (ms) a processBlock call took, measured with the portable
// monotonic clock (FR-WIN-AUD-3). An xrun is a call that took longer than the
// buffer duration it was asked to fill.
using SteadyClock = std::chrono::steady_clock;
static double elapsed_ms_since(SteadyClock::time_point t_start) {
    return std::chrono::duration<double, std::milli>(SteadyClock::now() - t_start).count();
}

struct CoreAudioDevice::Impl {
    AudioUnit unit{nullptr};
    ProcessFn processBlock;
    uint32_t  bufferSize{256};
    uint32_t  sampleRate{48000};
    uint32_t  inputChannels{1};

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
    // FR-EMU-3: AudioUnitRender failures, drained alongside xruns.
    std::atomic<uint32_t> renderErrors{0};
    // FR-EMU-3: the input hardware's actual queried sample rate (duplex
    // start() only), for the caller to compare against the engine's
    // configured rate.
    double actualInputSampleRate{0.0};
    // FR-WIN-AUD-6: the output device's buffer size read back after start;
    // the device may clamp the requested size to its allowed range.
    uint32_t actualBufferFrames{0};

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

        // Pull live input from AUHAL input bus. A failure here (device
        // unplugged mid-session, format renegotiation, etc.) previously went
        // unnoticed — inputBufList retains whatever it held (or the zeroed
        // buffer from the memset above); count it so it's surfaced instead of
        // silently producing wrong/stale input (FR-EMU-3).
        OSStatus render_status = AudioUnitRender(self->unit, ioActionFlags, inTimeStamp,
                                                  1 /*input bus*/, frames32, self->inputBufList);
        if (render_status != noErr) {
            self->renderErrors.fetch_add(1, std::memory_order_relaxed);
        }

        // Build stereo-interleaved input buffer from hardware input (handles mono→stereo).
        // Use pre-allocated member buffers — no heap allocation on the RT thread (AC-38).
        const size_t frames = static_cast<size_t>(frames32);
        // in_interleaved/out_interleaved were sized in start() from the same
        // maximum as inputBufList, and frames32 is clamped to that capacity, so
        // neither needs to grow here (FR-WIN-AUD-2).
        std::fill(self->in_interleaved.begin(),
                  self->in_interleaved.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);
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
        const auto t_start = SteadyClock::now();
        self->processBlock(self->in_interleaved.data(), self->out_interleaved.data(), frames);
        const double elapsed_ms = elapsed_ms_since(t_start);
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
        // silentInput/workOut were sized in start_output_only() from the device's
        // maximum callback size and never grow on this thread (FR-WIN-AUD-2); a
        // larger callback is clamped and its tail zero-filled below.
        const size_t frames = std::min(static_cast<size_t>(inNumberFrames),
                                       self->workOut.size() / 2);

        const auto t_start = SteadyClock::now();
        self->processBlock(self->silentInput.data(), self->workOut.data(), frames);
        const double elapsed_ms = elapsed_ms_since(t_start);
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
            for (UInt32 i = static_cast<UInt32>(frames); i < inNumberFrames; ++i) { outL[i] = 0.f; outR[i] = 0.f; }
        } else if (ioData->mNumberBuffers == 1) {
            float* outMono = static_cast<float*>(ioData->mBuffers[0].mData);
            for (size_t i = 0; i < frames; ++i)
                outMono[i] = self->workOut[2 * i];
            for (UInt32 i = static_cast<UInt32>(frames); i < inNumberFrames; ++i) outMono[i] = 0.f;
        }

        return noErr;
    }
};

CoreAudioDevice::CoreAudioDevice() {}

CoreAudioDevice::~CoreAudioDevice() {
    stop();  // stop() already resets impl_ (AC-50)
}

bool CoreAudioDevice::start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    if (running_) stop();

    impl_ = std::make_unique<Impl>();
    impl_->sampleRate   = sampleRate;
    impl_->bufferSize   = bufferSize;
    impl_->processBlock = std::move(processBlock);

    // Find the AUHAL component.
    AudioComponentDescription desc{};
    desc.componentType         = kAudioUnitType_Output;
    desc.componentSubType      = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (!comp) { impl_.reset(); return false; }

    if (AudioComponentInstanceNew(comp, &impl_->unit) != noErr) {
        impl_.reset(); return false;
    }

    // Enable output on bus 0, enable input on bus 1. FR-EMU-3: every setup
    // OSStatus is now checked — a failure here means the unit isn't in the
    // I/O configuration the render callback assumes, so bail out rather than
    // silently continuing with a half-configured AudioUnit.
    UInt32 one = 1, zero = 0;
    if (AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                             kAudioUnitScope_Output, 0, &one, sizeof(one)) != noErr) {
        stop(); return false;
    }
    if (AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                             kAudioUnitScope_Input, 1, &one, sizeof(one)) != noErr) {
        stop(); return false;
    }
    // Disable output side of input bus (required for duplex AUHAL).
    if (AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                             kAudioUnitScope_Output, 1, &zero, sizeof(zero)) != noErr) {
        stop(); return false;
    }

    // Explicitly set the default INPUT device on bus 1 so we get the microphone,
    // not the output device's (possibly absent) input channel. Captured at
    // function scope so its buffer-frame-size range can be queried below (FR-RTS-1).
    AudioDeviceID defaultInputDevice = kAudioDeviceUnknown;
    {
        UInt32 sz = sizeof(defaultInputDevice);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultInputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        // Querying the default input device itself is best-effort — if it
        // fails, defaultInputDevice stays kAudioDeviceUnknown and the AUHAL's
        // own default is used instead (not fatal).
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultInputDevice);
        if (defaultInputDevice != kAudioDeviceUnknown) {
            if (AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_CurrentDevice,
                                     kAudioUnitScope_Global, 1, &defaultInputDevice,
                                     sizeof(defaultInputDevice)) != noErr) {
                stop(); return false;
            }
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
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_StreamFormat,
                             kAudioUnitScope_Input, 0, &outFmt, sizeof(outFmt)) != noErr) {
        stop(); return false;
    }

    // Query the INPUT hardware's ACTUAL stream format (don't force it — mono mics are common).
    // This query is best-effort by design (mono mics / devices that don't
    // support the query are common) — its result is validated below instead.
    AudioStreamBasicDescription inFmt{};
    UInt32 inFmtSize = sizeof(inFmt);
    AudioUnitGetProperty(impl_->unit, kAudioUnitProperty_StreamFormat,
                         kAudioUnitScope_Output, 1, &inFmt, &inFmtSize);
    // If query failed, default to the same as output format.
    if (inFmt.mSampleRate == 0.0) inFmt = outFmt;
    impl_->inputChannels = inFmt.mChannelsPerFrame > 0 ? inFmt.mChannelsPerFrame : 1;
    // FR-EMU-3: record the actual queried input sample rate so the caller can
    // compare it against the engine's configured rate and surface a
    // sample_rate_mismatch event rather than silently resampling wrong.
    impl_->actualInputSampleRate = inFmt.mSampleRate;

    // Set hardware buffer size on the output device. Captured at function scope
    // so its buffer-frame-size range can be queried below (FR-RTS-1).
    AudioDeviceID defaultOutputDevice = kAudioDeviceUnknown;
    {
        UInt32 sz = sizeof(defaultOutputDevice);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultOutputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        // Querying the default output device itself is best-effort, same as above.
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultOutputDevice);
        if (defaultOutputDevice != kAudioDeviceUnknown) {
            UInt32 hwBuf = static_cast<UInt32>(bufferSize);
            AudioObjectPropertyAddress ba{kAudioDevicePropertyBufferFrameSize,
                                          kAudioObjectPropertyScopeGlobal,
                                          kAudioObjectPropertyElementMain};
            if (AudioObjectSetPropertyData(defaultOutputDevice, &ba, 0, nullptr,
                                           sizeof(hwBuf), &hwBuf) != noErr) {
                stop(); return false;
            }
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
    cb.inputProcRefCon = impl_.get();
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input, 0, &cb, sizeof(cb)) != noErr) {
        stop(); return false;
    }

    // RT-callback-visible buffers were already sized above from the queried
    // maximum frame count, before this call (FR-RTS-2) — no post-start resize.
    if (AudioUnitInitialize(impl_->unit) != noErr) { stop(); return false; }
    if (AudioOutputUnitStart(impl_->unit) != noErr) { stop(); return false; }
    impl_->actualBufferFrames = query_buffer_frames(defaultOutputDevice, sampleRate);

    running_ = true;
    return true;
}

bool CoreAudioDevice::start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    if (running_) stop();

    impl_ = std::make_unique<Impl>();
    impl_->sampleRate   = sampleRate;
    impl_->bufferSize   = bufferSize;
    impl_->processBlock = std::move(processBlock);

    AudioComponentDescription desc{};
    desc.componentType         = kAudioUnitType_Output;
    desc.componentSubType      = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (!comp) { impl_.reset(); return false; }

    if (AudioComponentInstanceNew(comp, &impl_->unit) != noErr) {
        impl_.reset(); return false;
    }

    // Output-only: enable bus 0 (output), disable bus 1 (input — no mic needed).
    // FR-EMU-3: check every setup OSStatus, same as start().
    UInt32 one = 1, zero = 0;
    if (AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                             kAudioUnitScope_Output, 0, &one, sizeof(one)) != noErr) {
        stop(); return false;
    }
    if (AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_EnableIO,
                             kAudioUnitScope_Input, 1, &zero, sizeof(zero)) != noErr) {
        stop(); return false;
    }

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
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_StreamFormat,
                             kAudioUnitScope_Input, 0, &outFmt, sizeof(outFmt)) != noErr) {
        stop(); return false;
    }

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
        // Querying the default output device itself is best-effort.
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultOutputDevice);
        if (defaultOutputDevice != kAudioDeviceUnknown) {
            UInt32 hwBuf = static_cast<UInt32>(bufferSize);
            AudioObjectPropertyAddress ba{kAudioDevicePropertyBufferFrameSize,
                                          kAudioObjectPropertyScopeGlobal,
                                          kAudioObjectPropertyElementMain};
            if (AudioObjectSetPropertyData(defaultOutputDevice, &ba, 0, nullptr,
                                           sizeof(hwBuf), &hwBuf) != noErr) {
                stop(); return false;
            }
        }
    }
    UInt32 maxOutFrames = query_max_buffer_frames(defaultOutputDevice, static_cast<UInt32>(bufferSize));
    impl_->silentInput.assign(static_cast<size_t>(maxOutFrames) * 2, 0.f);
    impl_->workOut.resize(static_cast<size_t>(maxOutFrames) * 2, 0.f);

    AURenderCallbackStruct cb{};
    cb.inputProc       = Impl::renderCallbackOutputOnly;
    cb.inputProcRefCon = impl_.get();
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input, 0, &cb, sizeof(cb)) != noErr) {
        stop(); return false;
    }

    // RT-callback-visible buffers were already sized above from the queried
    // maximum frame count, before this call (FR-RTS-2) — no post-start resize.
    if (AudioUnitInitialize(impl_->unit) != noErr) { stop(); return false; }
    if (AudioOutputUnitStart(impl_->unit) != noErr) { stop(); return false; }
    impl_->actualBufferFrames = query_buffer_frames(defaultOutputDevice, sampleRate);

    running_ = true;
    return true;
}

uint32_t CoreAudioDevice::maxCallbackFrames(uint32_t requestedBufferSize) const {
    // Same bound start() sizes its input buffers from (FR-RTS-1): the largest
    // frame count either default device can deliver in one I/O cycle.
    UInt32 maxFrames = requestedBufferSize;
    for (AudioObjectPropertySelector sel : {kAudioHardwarePropertyDefaultInputDevice,
                                            kAudioHardwarePropertyDefaultOutputDevice}) {
        AudioDeviceID dev = kAudioDeviceUnknown;
        UInt32 sz = sizeof(dev);
        AudioObjectPropertyAddress a{sel, kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &dev);
        maxFrames = query_max_buffer_frames(dev, maxFrames);
    }
    return maxFrames;
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
    impl_.reset();
    running_ = false;
}

uint32_t CoreAudioDevice::drainXruns() {
    if (!impl_) return 0;
    return impl_->xruns.exchange(0, std::memory_order_relaxed);
}

uint32_t CoreAudioDevice::drainRenderErrors() {
    if (!impl_) return 0;
    return impl_->renderErrors.exchange(0, std::memory_order_relaxed);
}

float CoreAudioDevice::queriedInputSampleRate() const {
    if (!impl_) return 0.f;
    return static_cast<float>(impl_->actualInputSampleRate);
}

uint32_t CoreAudioDevice::actualBufferFrames() const {
    if (!impl_) return 0;
    return impl_->actualBufferFrames;
}

float CoreAudioDevice::lastLatencyMs() const {
    if (!impl_) return 0.f;
    return impl_->latencyMs.load(std::memory_order_relaxed);
}

} // namespace daisy_emu
