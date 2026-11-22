#include "daisy_seed.h"
#include "daisysp.h"

using namespace daisy;
using namespace daisy::seed;
using namespace daisysp;

DaisySeed hw;

float volume = 1.0f;

// Audio Callback
void AudioCallback(AudioHandle::InputBuffer in, AudioHandle::OutputBuffer out, size_t size)
{
    for (size_t i = 0; i < size; i++)
    {
        // Prende solo il secondo canale (IN 2 → Index 1)
        //float input = in[1][i];
        // Legge dal ADC1
        float input = hw.adc.GetFloat(1);
        out[1][i] = input * volume; // Uscita su OUT 2 (Index 1)
        out[0][i] = 0.0f; // OUT 1 muto (opzionale)
    }
}

int main(void)
{
    hw.Configure();
    hw.Init();

    // Configura l'ADC per leggere il potenziometro su ADC0
    /*
    AdcChannelConfig adc_cfg;
    adc_cfg.InitSingle(A0); // Pin corrispondente ad ADC0
    hw.adc.Init(&adc_cfg, 1);
    */
    // Configura l'ADC per leggere il potenziometro su ADC0 e l'input audio su ADC1
    AdcChannelConfig adc_cfg[2];
    adc_cfg[0].InitSingle(A0); // Pin corrispondente ad ADC0
    adc_cfg[1].InitSingle(A1); // Pin corrispondente ad ADC1
    hw.adc.Init(adc_cfg, 2);

    hw.adc.Start();

    // Avvia l’audio
    hw.StartAudio(AudioCallback);

    while (1) {
        // Read the first ADC that's configured. In our case, this is the only input.
        volume = hw.adc.GetFloat(0);

        // In order to know that everything's working let's print that to a serial console:
        hw.PrintLine("ADC Value: %f", volume);

        // Wait half a second (500 milliseconds)
        System::Delay(500);
    }
}
