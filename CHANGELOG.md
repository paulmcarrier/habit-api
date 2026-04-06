# Changelog

## [1.1.0] - 2026-04-06
### Changed
- Replaced Swift binary calendar fetching with iCal parsing via `node-ical`
- Calendar now fetches directly from iCloud webcal feeds (Paul Personal + Family)
- Events filtered to today only, sorted by start time

### Fixed
- `npm test` now targets `index.test.js` explicitly to prevent hanging

### Added
- `habit-api.service` systemd unit file for deployment on agentp

## [1.0.0] - Initial release
- Habits CRUD API (SQLite-backed)
- Calendar endpoint via Swift binary
- Weather endpoint via Open-Meteo
- Health and version endpoints
