#include "core_audio_device.h"
#include <cstring>

#ifdef __APPLE__
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <mach/mach_time.h>
#include <cstdlib>
#include <vector>
#include <atomic>
#include <functional>

namespace daisy_emu {

static double s_mach_ns_per_tick = 0.0;

static void init_mach_timebase() {
    if (s_mach_ns_per_tick != 0.0) return;
    mach_timebase_info_data_t info;
    mach_timebase_info(&info);
    s_mach_ns_per_tick = static_cast<double>(info.numer) / static_cast<double>(info.denom);
}

struct CoreAudioDevice::Impl {
    AudioUnit unit{nullptr};
    ProcessFn processBlock;
    uint32_t  bufferSize{256};
    uint32_t  sampleRate{48000};
    uint32_t  inputChannels{1};

    // Input buffer list — allocated after querying hardware format, freed in stop().
    AudioBufferList* inputBufList{nullptr};

    std::atomic<uint32_t> xruns{0};
    std::atomic<float>    latencyMs{0.f};

    static OSStatus renderCallback(void*                       inRefCon,
                                   AudioUnitRenderActionFlags* ioActionFlags,
                                   const AudioTimeStamp*       inTimeStamp,
                                   UInt32                      /*inBusNumber*/,
                                   UInt32                      inNumberFrames,
                                   AudioBufferList*            ioData) {
        Impl* self = static_cast<Impl*>(inRefCon);

        // Reset input buffer sizes each callback (AudioUnitRender may update them).
        for (UInt32 b = 0; b < self->inputBufList->mNumberBuffers; ++b) {
            self->inputBufList->mBuffers[b].mDataByteSize =
                static_cast<UInt32>(inNumberFrames * sizeof(float));
            std::memset(self->inputBufList->mBuffers[b].mData, 0,
                        inNumberFrames * sizeof(float));
        }

        // Pull live input from AUHAL input bus.
        AudioUnitRender(self->unit, ioActionFlags, inTimeStamp, 1 /*input bus*/,
                        inNumberFrames, self->inputBufList);

        // Build stereo-interleaved input buffer from hardware input (handles mono→stereo).
        const size_t frames = static_cast<size_t>(inNumberFrames);
        std::vector<float> in_interleaved(frames * 2, 0.f);
        std::vector<float> out_interleaved(frames * 2, 0.f);

        if (self->inputChannels >= 2 && self->inputBufList->mNumberBuffers >= 2) {
            const float* inL = static_cast<const float*>(self->inputBufList->mBuffers[0].mData);
            const float* inR = static_cast<const float*>(self->inputBufList->mBuffers[1].mData);
            for (size_t i = 0; i < frames; ++i) {
                in_interleaved[2 * i]     = inL[i];
                in_interleaved[2 * i + 1] = inR[i];
            }
        } else if (self->inputBufList->mNumberBuffers >= 1) {
            // Mono input — duplicate to both channels
            const float* inMono = static_cast<const float*>(self->inputBufList->mBuffers[0].mData);
            for (size_t i = 0; i < frames; ++i) {
                in_interleaved[2 * i]     = inMono[i];
                in_interleaved[2 * i + 1] = inMono[i];
            }
        }

        // Run the effect.
        uint64_t t_start = mach_absolute_time();
        self->processBlock(in_interleaved.data(), out_interleaved.data(), frames);
        uint64_t t_end = mach_absolute_time();

        double elapsed_ms = static_cast<double>(t_end - t_start) * s_mach_ns_per_tick / 1e6;
        double budget_ms  = static_cast<double>(inNumberFrames) /
                            static_cast<double>(self->sampleRate) * 1000.0;
        if (elapsed_ms > budget_ms) {
            self->xruns.fetch_add(1, std::memory_order_relaxed);
        }
        self->latencyMs.store(static_cast<float>(budget_ms * 2.0), std::memory_order_relaxed);

        // Deinterleave effect output → CoreAudio non-interleaved buffers.
        if (ioData->mNumberBuffers >= 2) {
            float* outL = static_cast<float*>(ioData->mBuffers[0].mData);
            float* outR = static_cast<float*>(ioData->mBuffers[1].mData);
            for (size_t i = 0; i < frames; ++i) {
                outL[i] = out_interleaved[2 * i];
                outR[i] = out_interleaved[2 * i + 1];
            }
        } else if (ioData->mNumberBuffers == 1) {
            float* outMono = static_cast<float*>(ioData->mBuffers[0].mData);
            for (size_t i = 0; i < frames; ++i) {
                outMono[i] = out_interleaved[2 * i];
            }
        }

        return noErr;
    }
};

CoreAudioDevice::CoreAudioDevice() {
    init_mach_timebase();
}

CoreAudioDevice::~CoreAudioDevice() {
    stop();
    delete impl_;
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
    // not the output device's (possibly absent) input channel.
    {
        AudioDeviceID defaultInput = kAudioDeviceUnknown;
        UInt32 sz = sizeof(defaultInput);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultInputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultInput);
        if (defaultInput != kAudioDeviceUnknown) {
            AudioUnitSetProperty(impl_->unit, kAudioOutputUnitProperty_CurrentDevice,
                                 kAudioUnitScope_Global, 1, &defaultInput, sizeof(defaultInput));
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

    // Set hardware buffer size on the output device.
    {
        AudioDeviceID defaultOutput = kAudioDeviceUnknown;
        UInt32 sz = sizeof(defaultOutput);
        AudioObjectPropertyAddress a{kAudioHardwarePropertyDefaultOutputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, &defaultOutput);
        if (defaultOutput != kAudioDeviceUnknown) {
            UInt32 hwBuf = static_cast<UInt32>(bufferSize);
            AudioObjectPropertyAddress ba{kAudioDevicePropertyBufferFrameSize,
                                          kAudioObjectPropertyScopeGlobal,
                                          kAudioObjectPropertyElementMain};
            AudioObjectSetPropertyData(defaultOutput, &ba, 0, nullptr, sizeof(hwBuf), &hwBuf);
        }
    }

    // Allocate input buffer list based on the actual hardware channel count.
    size_t dataBytes = bufferSize * sizeof(float);
    uint32_t nBufs = impl_->inputChannels;
    impl_->inputBufList = static_cast<AudioBufferList*>(
        std::malloc(sizeof(AudioBufferList) + (nBufs - 1) * sizeof(AudioBuffer)));
    impl_->inputBufList->mNumberBuffers = nBufs;
    for (uint32_t ch = 0; ch < nBufs; ++ch) {
        impl_->inputBufList->mBuffers[ch].mNumberChannels = 1;
        impl_->inputBufList->mBuffers[ch].mDataByteSize   = static_cast<UInt32>(dataBytes);
        impl_->inputBufList->mBuffers[ch].mData           = std::malloc(dataBytes);
        std::memset(impl_->inputBufList->mBuffers[ch].mData, 0, dataBytes);
    }

    // Set the output render callback.
    AURenderCallbackStruct cb{};
    cb.inputProc       = Impl::renderCallback;
    cb.inputProcRefCon = impl_;
    if (AudioUnitSetProperty(impl_->unit, kAudioUnitProperty_SetRenderCallback,
                             kAudioUnitScope_Input, 0, &cb, sizeof(cb)) != noErr) {
        stop(); return false;
    }

    if (AudioUnitInitialize(impl_->unit) != noErr) { stop(); return false; }
    if (AudioOutputUnitStart(impl_->unit) != noErr) { stop(); return false; }

    running_ = true;
    return true;
}

void CoreAudioDevice::stop() {
    if (impl_ && impl_->unit) {
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

bool CoreAudioDevice::start(uint32_t, uint32_t, ProcessFn) {
    return false;
}

void CoreAudioDevice::stop() { running_ = false; }

uint32_t CoreAudioDevice::drainXruns() { return 0; }
float    CoreAudioDevice::lastLatencyMs() const { return 0.f; }

} // namespace daisy_emu

#endif // __APPLE__
