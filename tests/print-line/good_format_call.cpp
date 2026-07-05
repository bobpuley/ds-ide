// Compile-only fixture for FR-QA-EMU-7: a control matching bad_format_call.cpp
// with correctly-typed varargs. Must compile cleanly under the same
// -Werror=format flags — proving a real mismatch (not the flag itself) is
// what fails bad_format_call.cpp.
#include "daisy/daisy_seed_class.h"

int main() {
    daisy::DaisySeed hw;
    hw.PrintLine("%d", 42);
    return 0;
}
