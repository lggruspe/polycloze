# poly<u>cloze</u>

A self-hosted language learning website.

[Demo](https://demo.polycloze.com)

## Features

- Cloze deletion tests
- Auto-tuning spaced repetition algorithm
- Adaptive word scheduler
    + Word scheduler estimates the student's vocabulary so it can skip words that are too easy.
- [Automated course builder](./python)

## Usage

```bash
# Install everything needed to build front-end.
make init

# Run server.
make run

# Open in browser.
xdg-open http://localhost:3000
```

## Licenses

Copyright (C) 2022 Levi Gruspe

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

---

The scripts in [./scripts](./scripts) and
[./database/migrations](./database/migrations) are also available under the
terms of the MIT license.
