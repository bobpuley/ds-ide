# Vendored Daisy examples (test fixtures)

Four example effects from [electro-smith/DaisyExamples](https://github.com/electro-smith/DaisyExamples)
(MIT, see `LICENSE` in this folder), used as effect sources by the native emulator tests:
`tests/runtime/`, `tests/shim-compile/` and `tests/build-flags/`.

They used to be read from `daisy-seed-knowledge/examples/`, which is a gitignored local
corpus and so missing in CI. Vendoring them lets the tests run the same way locally and
on GitHub Actions, offline.

| File | Upstream | Changes |
|---|---|---|
| `bypass/bypass.cpp` | `seed/bypass/bypass.cpp` | none |
| `Knob/Knob.cpp` | `seed/Knob/Knob.cpp` | none |
| `Osc/Osc.cpp` | `seed/Osc/Osc.cpp` | adapted for the emulator tests: the button and envelope are commented out (constant amplitude), and the knob ADC uses `daisy::seed::A0` |
| `inout/InOut.cpp` | an InOut (block, non-interleaved) example | as taken from the local corpus |

Upstream reference commit: `728e93d2fa213df4e2b74160fa02f0f146fede87`. The tests' expected
values are calibrated against these exact copies; do not refresh them from upstream without
re-running `bash tests/runtime/build_and_test.sh` and `bash tests/shim-compile/run_compile_tests.sh`.
