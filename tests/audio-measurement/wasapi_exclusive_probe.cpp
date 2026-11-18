// WASAPI exclusive-mode probe for the measurement gate (M80 / FR-WIN-AUD-7).
//
// RtAudio 6.0.1 opens WASAPI in shared mode only, so the "WASAPI exclusive"
// column is measured with this minimal native, event-driven IAudioClient
// render loop. It is a measurement tool only — never linked into effect_emu.
// It renders silence (format-agnostic) on the default render endpoint and
// prints the same markdown row as measure_backend.
//
// Usage: wasapi_exclusive_probe <requestedFrames> [seconds=10] [sampleRate=48000]
// Exit code: 0 = measured, 2 = exclusive mode could not be opened.

#ifndef _WIN32
#error "wasapi_exclusive_probe is Windows-only"
#endif

#include "measure_stats.h"

#include <windows.h>
#include <audioclient.h>
#include <avrt.h>
#include <mmdeviceapi.h>
#include <mmreg.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>

using namespace audio_measure;
using Clock = std::chrono::steady_clock;

namespace {

// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT / _PCM, defined here to avoid a ksguid dependency.
const GUID kSubtypeFloat = {0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};
const GUID kSubtypePcm   = {0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};

template <typename T> void release(T*& p) { if (p) { p->Release(); p = nullptr; } }

WAVEFORMATEXTENSIBLE make_format(uint32_t rate, const GUID& subtype, WORD bits, WORD validBits) {
    WAVEFORMATEXTENSIBLE f{};
    f.Format.wFormatTag      = WAVE_FORMAT_EXTENSIBLE;
    f.Format.nChannels       = 2;
    f.Format.nSamplesPerSec  = rate;
    f.Format.wBitsPerSample  = bits;
    f.Format.nBlockAlign     = static_cast<WORD>(2 * bits / 8);
    f.Format.nAvgBytesPerSec = rate * f.Format.nBlockAlign;
    f.Format.cbSize          = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
    f.Samples.wValidBitsPerSample = validBits;
    f.dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    f.SubFormat     = subtype;
    return f;
}

REFERENCE_TIME frames_to_hns(uint32_t frames, uint32_t rate) {
    return static_cast<REFERENCE_TIME>(10000000.0 * frames / rate + 0.5);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <requestedFrames> [seconds] [sampleRate]\n", argv[0]);
        return 1;
    }
    const uint32_t request = static_cast<uint32_t>(std::strtoul(argv[1], nullptr, 10));
    const double   seconds = argc > 2 ? std::atof(argv[2]) : 10.0;
    const uint32_t rate    = argc > 3 ? static_cast<uint32_t>(std::strtoul(argv[3], nullptr, 10)) : 48000;
    auto fail = [](const char* what, HRESULT hr) {
        std::fprintf(stderr, "[probe] %s failed (hr=0x%08lx)\n", what, static_cast<unsigned long>(hr));
        return 2;
    };

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) return fail("CoInitializeEx", hr);

    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDevice*           device     = nullptr;
    IAudioClient*        client     = nullptr;
    IAudioRenderClient*  render     = nullptr;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                          __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr)) return fail("CoCreateInstance(MMDeviceEnumerator)", hr);
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    if (FAILED(hr)) return fail("GetDefaultAudioEndpoint", hr);
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&client));
    if (FAILED(hr)) return fail("Activate(IAudioClient)", hr);

    // First stereo format the endpoint accepts in exclusive mode.
    const WAVEFORMATEXTENSIBLE candidates[] = {
        make_format(rate, kSubtypeFloat, 32, 32),
        make_format(rate, kSubtypePcm, 32, 24),
        make_format(rate, kSubtypePcm, 24, 24),
        make_format(rate, kSubtypePcm, 16, 16),
    };
    const WAVEFORMATEXTENSIBLE* fmt = nullptr;
    for (const auto& c : candidates) {
        if (client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                      reinterpret_cast<const WAVEFORMATEX*>(&c), nullptr) == S_OK) {
            fmt = &c;
            break;
        }
    }
    if (!fmt) return fail("IsFormatSupported(exclusive, stereo, requested rate)", AUDCLNT_E_UNSUPPORTED_FORMAT);

    REFERENCE_TIME defPeriod = 0, minPeriod = 0;
    client->GetDevicePeriod(&defPeriod, &minPeriod);
    REFERENCE_TIME period = std::max(frames_to_hns(request, rate), minPeriod);

    hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period,
                            reinterpret_cast<const WAVEFORMATEX*>(fmt), nullptr);
    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
        // Documented retry: re-activate and initialise with the aligned size.
        UINT32 aligned = 0;
        client->GetBufferSize(&aligned);
        release(client);
        hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&client));
        if (FAILED(hr)) return fail("re-Activate(IAudioClient)", hr);
        period = frames_to_hns(aligned, rate);
        hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period,
                                reinterpret_cast<const WAVEFORMATEX*>(fmt), nullptr);
    }
    if (FAILED(hr)) return fail("Initialize(exclusive)", hr);

    HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!event) return fail("CreateEvent", HRESULT_FROM_WIN32(GetLastError()));
    client->SetEventHandle(event);
    UINT32 bufferFrames = 0;
    client->GetBufferSize(&bufferFrames);
    hr = client->GetService(__uuidof(IAudioRenderClient), reinterpret_cast<void**>(&render));
    if (FAILED(hr)) return fail("GetService(IAudioRenderClient)", hr);
    REFERENCE_TIME streamLatency = 0;
    client->GetStreamLatency(&streamLatency);

    BYTE* data = nullptr;
    if (SUCCEEDED(render->GetBuffer(bufferFrames, &data)))
        render->ReleaseBuffer(bufferFrames, AUDCLNT_BUFFERFLAGS_SILENT);

    DWORD taskIndex = 0;
    HANDLE task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

    std::vector<CallbackSample> samples;
    samples.reserve(static_cast<size_t>((seconds + 1) * rate / std::max<UINT32>(bufferFrames, 1)) + 64);
    uint32_t timeouts = 0, bufferErrors = 0;

    hr = client->Start();
    if (FAILED(hr)) return fail("Start", hr);
    const auto t0 = Clock::now();
    const auto settle = t0 + std::chrono::milliseconds(500);
    const auto end = settle + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(seconds));
    while (Clock::now() < end) {
        if (WaitForSingleObject(event, 2000) != WAIT_OBJECT_0) { ++timeouts; continue; }
        const auto now = Clock::now();
        if (render->GetBuffer(bufferFrames, &data) == S_OK)
            render->ReleaseBuffer(bufferFrames, AUDCLNT_BUFFERFLAGS_SILENT);
        else
            ++bufferErrors;
        if (now >= settle)
            samples.push_back({std::chrono::duration<double, std::milli>(now - t0).count(), bufferFrames});
    }
    client->Stop();
    if (task) AvRevertMmThreadCharacteristics(task);

    const float latencyMs = static_cast<float>(streamLatency / 10000.0 + 1000.0 * bufferFrames / rate);
    RunInfo info{"WASAPI exclusive (native probe)", request, rate, bufferFrames, latencyMs, timeouts, bufferErrors};
    std::printf("%s\n", format_row(info, compute_stats(samples, rate)).c_str());

    CloseHandle(event);
    release(render);
    release(client);
    release(device);
    release(enumerator);
    CoUninitialize();
    return 0;
}
