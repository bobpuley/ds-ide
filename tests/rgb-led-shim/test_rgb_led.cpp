// Unit test for the RgbLed shim (M44, FR-DEV-8).
//
// Verifies that RgbLed::Set/Update emits `rgbLed` IPC messages keyed to the
// red-channel pin, with change-deduplication across all three channels.
// Plain asserts; exit 0 on pass.

#include "daisy/rgb_led.h"
#include "emulator_state.h"
#include "led_telemetry.h"
#include <memory>

#include <cstdio>
#include <string>
#include <vector>

namespace daisy_emu {
EmulatorState g_state;  // single global, as defined in runtime/main.cpp
}

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static dsy_gpio_pin pin(uint8_t n) { return dsy_gpio_pin{0, n}; }

// FR-EMU-13: the drain side samples RGB state (LedSampler) instead of
// popping a queue; it emits only when a colour changed.
static std::unique_ptr<daisy_emu::LedSampler> g_sampler = std::make_unique<daisy_emu::LedSampler>();
static std::vector<std::string> drain_queue() {
    std::vector<std::string> result;
    g_sampler->collect([&](const char* m) { result.push_back(m); });
    return result;
}

static void reset_state() {
    for (auto& v : daisy_emu::g_state.rgb_state) v.store(0);
    g_sampler = std::make_unique<daisy_emu::LedSampler>();
}

static bool contains(const std::string& s, const std::string& sub) {
    return s.find(sub) != std::string::npos;
}

static void test_set_and_update_emits_on_red_pin() {
    std::printf("--- test_set_and_update_emits_on_red_pin ---\n");
    reset_state();
    daisy::RgbLed led;
    led.Init(pin(5), pin(6), pin(7));
    led.Set(1.f, 0.5f, 0.f);
    led.Update();
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "Update() enqueues one rgbLed message");
    CHECK(contains(msgs.back(), "\"gpioPin\":5"), "keyed by the red-channel (first) pin");
    CHECK(contains(msgs.back(), "\"r\":1.0000"), "r channel carried");
    CHECK(contains(msgs.back(), "\"g\":0.5000"), "g channel carried");
    CHECK(contains(msgs.back(), "\"b\":0.0000"), "b channel carried");
}

static void test_dedup_unchanged_color() {
    std::printf("--- test_dedup_unchanged_color ---\n");
    reset_state();
    daisy::RgbLed led;
    led.Init(pin(5), pin(6), pin(7));
    led.Set(0.2f, 0.3f, 0.4f);
    led.Update();
    led.Update();
    led.Update();
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "repeated Update() with the same color enqueues only once");
}

static void test_any_channel_change_re_emits() {
    std::printf("--- test_any_channel_change_re_emits ---\n");
    reset_state();
    daisy::RgbLed led;
    led.Init(pin(5), pin(6), pin(7));
    led.Set(0.2f, 0.3f, 0.4f);
    led.Update();
    drain_queue();

    led.SetBlue(0.9f);  // only blue changes
    led.Update();
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "changing just one channel still re-emits");
    CHECK(contains(msgs.back(), "\"b\":0.9000"), "updated channel value is carried");
}

static void test_set_without_update_is_silent() {
    std::printf("--- test_set_without_update_is_silent ---\n");
    reset_state();
    daisy::RgbLed led;
    led.Init(pin(5), pin(6), pin(7));
    led.Set(1.f, 1.f, 1.f);  // no Update()
    auto msgs = drain_queue();
    CHECK(msgs.empty(), "Set() without Update() enqueues nothing");
}

static void test_two_instances_independent() {
    std::printf("--- test_two_instances_independent ---\n");
    reset_state();
    daisy::RgbLed a, b;
    a.Init(pin(5), pin(6), pin(7));
    b.Init(pin(10), pin(11), pin(12));
    a.Set(1.f, 0.f, 0.f);
    a.Update();
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "instance A emits");
    CHECK(contains(msgs.back(), "\"gpioPin\":5"), "instance A keyed by its own red pin");

    b.Set(0.f, 1.f, 0.f);
    b.Update();
    msgs = drain_queue();
    CHECK(msgs.size() == 1, "instance B emits independently");
    CHECK(contains(msgs.back(), "\"gpioPin\":10"), "instance B keyed by its own red pin");
}

int main() {
    std::printf("=== RgbLed shim unit tests (M44, FR-DEV-8) ===\n");
    test_set_and_update_emits_on_red_pin();
    test_dedup_unchanged_color();
    test_any_channel_change_re_emits();
    test_set_without_update_is_silent();
    test_two_instances_independent();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
