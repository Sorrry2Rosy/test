# UAV Firefighting 3D Command System

## Prerequisites

- [.NET 8.0 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
- MySQL Server (see `appsettings.json` for connection string)

## Setup

### 1. SuperMap iClient3D SDK

This project depends on SuperMap iClient3D (Cesium-based). The SDK is **not** included in this repository.

- Download the SuperMap iClient3D SDK from the [SuperMap official website](https://www.supermap.com/en-us/html/download.html)
- Place the entire SDK under `wwwroot/Build/` so that the following files exist:
  - `wwwroot/Build/SuperMap3D/SuperMap3D.js`
  - `wwwroot/Build/SuperMap3D/Widgets/widgets.css`
  - `wwwroot/Build/deps.js`

```
wwwroot/
└── Build/
    ├── deps.js
    └── SuperMap3D/
        ├── SuperMap3D.js
        ├── Widgets/
        │   └── widgets.css
        ├── Assets/
        └── ...
```

### 2. GIS Base Map Data

The GIS shapefile data used for the 2D base map is **not** included in this repository due to file size limits.

- Obtain the folder `二维底图shp0517第二版` from your team
- Place it at the **project root** so the path is:
  - `<project root>/二维底图shp0517第二版/深圳路网_1.shp`
  - `<project root>/二维底图shp0517第二版/建筑底图.shp`
  - etc.

```
new try world/
├── 二维底图shp0517第二版/    ← place here
├── wwwroot/
├── Program.cs
└── ...
```

### 3. Restore & Run

```bash
dotnet restore
dotnet run
```

The application will be available at `http://localhost:5000` (or the port configured in `Properties/launchSettings.json`).

## Project Structure

| Path | Description |
|------|-------------|
| `wwwroot/project/` | Frontend pages (HTML, CSS, JS) |
| `wwwroot/Build/` | SuperMap iClient3D SDK (not in repo) |
| `二维底图shp0517第二版/` | GIS base map shapefiles (not in repo) |
| `成果/` | Generated output and processed data |
| `Services/` | C# backend services |
| `Models/` | C# data models |
| `Data/` | Data access layer |

## Notes

- The `.gitignore` excludes `wwwroot/Build/`, `二维底图shp0517第二版/`, `bin/`, and `obj/`. After cloning, you must restore the two excluded directories manually.
- Make sure MySQL is running and the connection string in `appsettings.json` is correct before starting the application.
- The frontend entry point is `wwwroot/project/index.html`.
