# View problems

1. when open a project with valid controllers.yaml, the Controls editor doesn't load the configuration; it does it only after the deployment. But I have the feeling that it can be done at opening time
2. when open a project with valid code block wrappers (and controllers.yaml), the Wiring editor doesn't re-load anything, so it looks like the user didn't wired anything, or he's not respecting the coding rules. But again I have the feeling that this is a static analysis that can be performed at any times
3. the daisy seed canvas for the wiring editor contains several mistakes from the beginning, because we inferred the info from an image (check the [Seed_pinout.csv](Seed_pinout.csv) document for exact information). The board orientation and the usb position are not coherent.
   wrong (current)
   ```
              | usb |
            +---------+
        D1  |         |  3V3
        D0  |         |  VIN
        D2  |         |  GND
        D3  |         |  BOOT
        ....
   ```
   right
   ```
              | usb |
            +---------+
        D0  |         |  DGND
        D1  |         |  VIN
        D2  |         |  3V3
        D3  |         |  D30
        ...        
   ```