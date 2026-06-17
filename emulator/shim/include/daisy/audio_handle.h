#pragma once
#include <cstddef>

namespace daisy {

// Mirrors the libDaisy AudioHandle buffer and callback types used by all
// Daisy Seed effects.  The two callback forms are source-incompatible with
// each other (FR-SH-2 / 04 §4.1):
//
//   Interleaved  — packed L/R in one flat array  (v1.0, 44 examples)
//   Block/non-interleaved — separate per-channel pointers (v1.1, 28 examples)

class AudioHandle {
public:
    // ---- Interleaved form (v1.0) ----------------------------------------
    using InterleavingInputBuffer  = const float*;
    using InterleavingOutputBuffer = float*;

    using InterleavingAudioCallback = void (*)(InterleavingInputBuffer  in,
                                               InterleavingOutputBuffer out,
                                               size_t                   size);

    // ---- Non-interleaved/block form (v1.1) --------------------------------
    using InputBuffer  = const float* const*;
    using OutputBuffer = float* const*;

    using AudioCallback = void (*)(InputBuffer  in,
                                   OutputBuffer out,
                                   size_t       size);
};

} // namespace daisy
