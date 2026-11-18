// Parity check: real libDaisy's daisy_core.h includes <stdlib.h>, so an effect
// that includes only "daisy_seed.h" can already use RAND_MAX, rand(), abs()...
// DaisySP relies on it (Utility/dsp.h uses RAND_MAX without including <cstdlib>).
// On macOS the header happens to arrive through other includes; with the
// MinGW / libc++ headers it does not, so the shim must provide it itself.
//
// Compile-only: no linking, no main().

#include "daisy_seed.h"

static_assert(RAND_MAX > 0, "daisy_seed.h must make RAND_MAX available, as libDaisy does");

inline int shim_stdlib_parity() { return std::abs(-1) + abs(-1); }
