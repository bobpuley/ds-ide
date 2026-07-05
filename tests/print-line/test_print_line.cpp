// Unit test for FR-QA-EMU-7 (the runtime half): DaisySeed::PrintLine() emits
// \r\n line endings, matching real hardware (which terminates lines with
// \r\n over its UART/USB-CDC logger), instead of a host-convention \n.
//
// The compile-time half of FR-QA-EMU-7 (the format(printf, 2, 3) attribute
// catching a mismatched varargs call) is checked separately by
// run_tests.sh, since it's a property of what the compiler does with a
// second translation unit, not something this binary can observe about
// itself at runtime.

#include "daisy/daisy_seed_class.h"
#include "emulator_state.h"

#include <cstdio>
#include <string>
#include <unistd.h>

namespace daisy_emu { EmulatorState g_state; }

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

// Captures everything written to stdout during `fn()` and returns it.
static std::string capture_stdout(void (*fn)()) {
    fflush(stdout);
    int saved_fd = dup(STDOUT_FILENO);
    int pipefd[2];
    pipe(pipefd);
    dup2(pipefd[1], STDOUT_FILENO);
    close(pipefd[1]);

    fn();
    fflush(stdout);

    char buf[4096];
    // Make the read end nonblocking-safe by writing a sentinel and reading
    // up to it — simplest robust approach here is to close the write side
    // (via restoring stdout) then read until EOF.
    dup2(saved_fd, STDOUT_FILENO);
    close(saved_fd);

    ssize_t n = read(pipefd[0], buf, sizeof(buf) - 1);
    close(pipefd[0]);
    if (n < 0) n = 0;
    buf[n] = '\0';
    return std::string(buf, static_cast<size_t>(n));
}

static void call_print_plain() {
    daisy::DaisySeed hw;
    hw.PrintLine("hello");
}

static void call_print_formatted() {
    daisy::DaisySeed hw;
    hw.PrintLine("value=%d", 42);
}

int main() {
    std::printf("=== DaisySeed::PrintLine unit tests (M41 / FR-QA-EMU-7) ===\n\n");

    {
        std::string out = capture_stdout(call_print_plain);
        CHECK(out == "hello\r\n",
              "PrintLine emits \\r\\n after the message, matching hardware's UART/USB-CDC line ending");
    }
    {
        std::string out = capture_stdout(call_print_formatted);
        CHECK(out == "value=42\r\n",
              "a printf-style format argument is substituted before the \\r\\n terminator");
    }

    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
