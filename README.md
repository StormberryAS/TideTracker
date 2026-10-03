# TideTracker

A privacy-first prototype that shows the moon's phase for any date and place, and whether tides are near their spring or neap range: spring tides, the larger ones, come around new and full moon; neap tides, the smaller ones, around the first and last quarter.

**It does not predict tide times or heights.** For those, use local tide tables; in Norway, [Kartverket's](https://www.kartverket.no/til-sjos/se-havniva).

**Live:** [tide.stormberry.as](https://tide.stormberry.as)

## Features
- **City search**: rapid, offline autocomplete over 25,007 cities, shared with the other Labs apps.
- **Manual GPS input**: any point on the globe. A decimal comma works as well as a point (`60,39` or `60.39`), and so does a typographic minus; anything out of range is refused with a message rather than computed.
- **Moon phase**: the phase at local noon on the chosen date, and how much of the moon is lit.
- **Spring and neap**: where the tides stand in the spring and neap cycle, with the dates of the next new or full moon and the next quarter moon.
- **Privacy first**: fully client-side. The page never asks for the device's location; a place comes from city search or from typed coordinates.

## How it works
- The phase is the moon's elongation from the sun, using the main lunar terms in Jean Meeus, *Astronomical Algorithms* (chapters 25 and 47). Checked against PyEphem for every new moon, quarter and full moon of 2026 and 2027: worst error 8 minutes.
- The lit fraction comes from [SunCalc](https://github.com/mourner/suncalc), bundled locally.
- Until 2 October 2026 the page also showed high and low tide times and a water-level bar. They were not tide predictions (they were derived from the coordinates alone), so they were removed. Real tide times need harmonic constants for each port.

## Architecture
- **Vanilla HTML/CSS/JS**, no frameworks, no build step.
- Stormberry dark-mode glassmorphism design system.

## Disclaimer

Supplied free of charge, **as is**, with no warranty of any kind. Using it creates no client or advisory relationship with Stormberry AS, and nothing it produces is professional advice.

**Not for navigation, and not a tide table.** TideTracker does not predict tide times or water levels. It shows the moon's phase and, from that alone, whether tides are generally near their spring or neap range. When high and low water come at a particular place, and how high they reach, depends on local geography, weather, storm surge and river flow, none of which this application models. For navigation, mooring or any activity on or near the water, use official tide tables from [Kartverket](https://www.kartverket.no/til-sjos/se-havniva) or your national hydrographic office.

This is a **functioning prototype**, not a certified instrument and not a professional service. Values are computed or modelled, not measured. Check anything that matters against an authoritative source before you act on it. Stormberry AS reimburses no cost or loss arising from use of this application.

Full terms: [DISCLAIMER.md](DISCLAIMER.md).
