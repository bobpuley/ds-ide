// Compile-only fixture for FR-QA-EMU-7's format-check attribute: this call's
// varargs (a const char*) mismatch the "%d" (int) format specifier. It must
// fail to compile under -Werror=format, proving PrintLine's
// __attribute__((format(printf, 2, 3))) is active and catching the same
// class of mismatched-varargs bug the format attribute exists to catch.
#include "daisy/daisy_seed_class.h"

int main() {
    daisy::DaisySeed hw;
    hw.PrintLine("%d", "not an int");
    return 0;
}
