# Controls logger (SD card)

The [`controls-tour`](../controls-tour) example plus an SD card: every change you make to a control is written as a line in `actions.txt` on the card. Read that example's README first; this one only describes what is new.

## What you will learn

- How an SD card is declared and mounted in a Daisy project (`SdmmcHandler`, `FatFSInterface`, `f_mount`), and how the Wiring Editor adds it for you (`ds-ide:peripherals` block).
- How to write a file: `f_open`, `f_write`, `f_sync`.
- **Why the audio callback must not touch the card.** File I/O can take milliseconds, and an audio callback that waits glitches the sound. So the callback only notices changes and drops small events into a lock-free queue, and the main loop takes them out and does the writing. This pattern is how real Daisy effects talk to slow peripherals.

## How to run it

1. Open this folder in VS Code (`File > Open Folder`) and **trust the folder** when asked.
2. Open `controls_sd_logger.cpp` and click the play button at the top right of the editor, or run **Daisy IDE: Run Daisy Effect**.
3. Use the controls in the **Controls Editor**: move a pot, hold **Mute**, click the **Mode** toggle, drag the **Dial**.
4. Look at the **SD Card** section of the Controls Editor. It lists the files on the card, and clicking `actions.txt` shows a preview.

## What gets logged

| You do | Line written |
|---|---|
| Move the Gain or Tone pot | `gain 70%` or `tone 40%` (in steps of 10 %, so a pot's jitter does not flood the log) |
| Hold or release Mute | `mute pressed` or `mute released` |
| Click the Mode toggle | `mode 0`, `mode 1` or `mode 2` |
| Drag the Dial | `drive 65%` |

Each line starts with a counter, and the first line is `session start`. The positions the controls start in are not logged, only what you change.

## Where the file is

The emulated card is the folder `sdcard/` inside your project. After a run you will find `sdcard/actions.txt` next to `controls_sd_logger.cpp`, and you can open it in the editor like any other file. The log starts fresh on every run: the example opens it with `FA_CREATE_ALWAYS`, so the previous run's log is replaced.

## Things to try

- Move a pot back and forth and watch the SD viewer: only changes that cross a 10 % step are logged.
- Change the pot step in `AudioCallback` (the `* 10.0f` and `* 10` factors) to log every 5 % or every 1 %.
- Add an event for something new, for example the colour LED mode: add a value to `EventKind`, push it in the callback and format it in `LogEvent()`.
- Make the queue tiny (`kQueueSize = 4`), move a pot fast, and see that events can be dropped when the writer falls behind. The audio never stalls, which is the point of the design.

## Limits to know about

- The SD card shim stores files in a normal folder; there is no 4 GB limit, no FAT formatting and no card-removed state.
- Pins D1 to D6 are the SD card's bus, so this example keeps the controls off them.

## Files

- `controls_sd_logger.cpp`: the effect, with the event queue, the logger, and the `ds-ide:controls` and `ds-ide:peripherals` blocks.
- `controllers.yaml`: labels, ranges and editor positions of the virtual controls.
- `CMakeLists.txt`: lets the extension recognise the folder as a project. The emulator build uses its own CMake file.
