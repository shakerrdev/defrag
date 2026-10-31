param(
  [switch]$Watch,
  [switch]$Launch,
  [string]$Cs2Path,
  [ValidateSet("low", "mid", "high", "pro")]
  [string]$Tier = "pro",
  [string[]]$Map = @(),
  [switch]$RedoMap
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$AddonName = 'defrag'
$RepoZip = 'https://github.com/shakerrdev/defrag/archive/refs/heads/main.zip'
$PnpmVersion = '10.28.0'
$MinNode = [version]'22.18.0'
$Home_ = Join-Path $env:LOCALAPPDATA 'defrag'
$Tools = Join-Path $Home_ 'tools'
$VrfVersion = '20.1'
$VrfZip = "https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/$VrfVersion/cli-windows-x64.zip"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

function Get-Repo {
  if ($PSScriptRoot) {
    $candidate = Split-Path $PSScriptRoot -Parent
    if (Test-Path (Join-Path $candidate 'pnpm-workspace.yaml')) {
      Ok "using the repo at $candidate"
      if ((Test-Path (Join-Path $candidate '.git')) -and (Get-Command git.exe -ErrorAction SilentlyContinue)) {
        git -C $candidate pull --ff-only | Out-Host
        if ($LASTEXITCODE -ne 0) { Warn 'git pull failed, continuing with the local version' }
      }
      return $candidate
    }
  }
  $target = Join-Path $Home_ 'repo'
  $zip = Join-Path $Home_ 'defrag-main.zip'
  $unpack = Join-Path $Home_ 'unpack'
  New-Item -ItemType Directory -Force $Home_ | Out-Null
  Info "downloading the latest version from GitHub"
  Invoke-WebRequest $RepoZip -OutFile $zip -UseBasicParsing
  if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpack)
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Move-Item (Join-Path $unpack 'defrag-main') $target
  Remove-Item $unpack, $zip -Recurse -Force
  Ok "downloaded to $target"
  return $target
}

function Get-NodeDir {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) {
    $version = [version]((& $node.Source --version).TrimStart('v'))
    if ($version -ge $MinNode) {
      Ok "using installed Node $version"
      return Split-Path $node.Source -Parent
    }
    Info "installed Node $version is older than $MinNode, using a private copy instead"
  }
  $arch = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  $existing = Get-ChildItem $Tools -Directory -Filter "node-v*-win-$arch" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($existing) {
    Ok "using Node from $($existing.FullName)"
    return $existing.FullName
  }
  $release = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1
  $name = "node-$($release.version)-win-$arch"
  $zip = Join-Path $Tools "$name.zip"
  New-Item -ItemType Directory -Force $Tools | Out-Null
  Info "downloading Node $($release.version) (LTS)"
  Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/$name.zip" -OutFile $zip -UseBasicParsing
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Tools)
  Remove-Item $zip -Force
  $dir = Join-Path $Tools $name
  Ok "Node installed to $dir (private, nothing changed system-wide)"
  return $dir
}

function Install-Pnpm($nodeDir) {
  $prefix = Join-Path $Tools 'pnpm'
  $cli = Join-Path $prefix 'node_modules\pnpm\bin\pnpm.cjs'
  $package = Join-Path $prefix 'node_modules\pnpm\package.json'
  $current = $null
  if (Test-Path $package) { $current = (Get-Content $package -Raw | ConvertFrom-Json).version }
  if ($current -ne $PnpmVersion) {
    Info "installing pnpm $PnpmVersion"
    & (Join-Path $nodeDir 'npm.cmd') install --prefix $prefix "pnpm@$PnpmVersion" --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw 'installing pnpm failed' }
  }
  $bin = Join-Path $Tools 'bin'
  New-Item -ItemType Directory -Force $bin | Out-Null
  Set-Content (Join-Path $bin 'pnpm.cmd') "@`"$nodeDir\node.exe`" `"$cli`" %*" -Encoding ASCII
  $env:PATH = "$bin;$nodeDir;$env:PATH"
  Ok "pnpm $PnpmVersion ready"
}

function Find-Cs2 {
  if ($Cs2Path) {
    if (Test-Path (Join-Path $Cs2Path 'game\bin\win64\cs2.exe')) { return (Resolve-Path $Cs2Path).Path }
    throw "no cs2.exe under $Cs2Path\game\bin\win64"
  }
  $steam = $null
  foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
    $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($props.SteamPath) { $steam = $props.SteamPath; break }
    if ($props.InstallPath) { $steam = $props.InstallPath; break }
  }
  if (-not $steam) { $steam = "${env:ProgramFiles(x86)}\Steam" }
  $steam = $steam -replace '/', '\'
  $libraries = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) {
    foreach ($match in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
      $libraries += $match.Groups[1].Value -replace '\\\\', '\'
    }
  }
  foreach ($library in ($libraries | Select-Object -Unique)) {
    $manifest = Join-Path $library 'steamapps\appmanifest_730.acf'
    if (-not (Test-Path $manifest)) { continue }
    $installDir = 'Counter-Strike Global Offensive'
    $found = [regex]::Match((Get-Content $manifest -Raw), '"installdir"\s+"([^"]+)"')
    if ($found.Success) { $installDir = $found.Groups[1].Value }
    $dir = Join-Path $library "steamapps\common\$installDir"
    if (Test-Path (Join-Path $dir 'game\bin\win64\cs2.exe')) { return $dir }
  }
  throw 'CS2 not found in any Steam library. Run again with -Cs2Path "<folder that contains game and content>".'
}

function Write-ScriptConfig($cs2, $name, $script, $what) {
  $cfg = Join-Path $cs2 "game\csgo\cfg\$name.cfg"
  $lines = @(
    "// written by the defrag setup script: loads $what into the running map",
    'sv_cheats 1',
    "ent_create point_script { ""targetname"" ""$name"" ""cs_script"" ""maps/scripts/$script.vjs"" }"
  )
  Set-Content $cfg $lines -Encoding ASCII
  Ok "wrote $cfg"
}

function Extract-Scenarios($cs2, $repo, $addonContent) {
  $packs = Join-Path $addonContent 'scenario-packs'
  $sources = @(
    @{ Dir = (Join-Path $repo 'demos'); Tier = $Tier },
    @{ Dir = (Join-Path $cs2 'game\csgo\replays'); Tier = 'mid' }
  )
  foreach ($source in $sources) {
    if (-not (Test-Path $source.Dir)) { continue }
    $demos = @(Get-ChildItem $source.Dir -Filter *.dem | ForEach-Object { $_.FullName })
    if (-not $demos.Count) { continue }
    Info "$($demos.Count) demo(s) in $($source.Dir), tier $($source.Tier)"
    $ErrorActionPreference = 'Continue'
    pnpm extract --tier $source.Tier --out $packs @demos
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { Warn 'some demos could not be read, the rest were used' }
  }
  if (Test-Path $packs) {
    Get-ChildItem $packs -Filter *.json | ForEach-Object { Ok "pack $($_.BaseName)" }
  } else {
    Warn "no scenario packs yet: put demos in $(Join-Path $repo 'demos') or record peeks in game (!hold, !rec)"
  }
}

function Get-Decompiler {
  $dir = Join-Path $Tools "source2viewer-$VrfVersion"
  $cli = Join-Path $dir 'Source2Viewer-CLI.exe'
  if (Test-Path $cli) { return $cli }
  New-Item -ItemType Directory -Force $dir | Out-Null
  $zip = Join-Path $Tools 'source2viewer-cli.zip'
  Info "downloading Source 2 Viewer CLI $VrfVersion (map decompiler, ~50 MB)"
  Invoke-WebRequest $VrfZip -OutFile $zip -UseBasicParsing
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $dir)
  Remove-Item $zip -Force
  $found = Get-ChildItem $dir -Recurse -Filter 'Source2Viewer-CLI.exe' | Select-Object -First 1
  if (-not $found) { throw "Source2Viewer-CLI.exe not found in $VrfZip" }
  if ($found.FullName -ne $cli) { Move-Item (Join-Path $found.DirectoryName '*') $dir -Force }
  Ok "decompiler in $dir"
  return $cli
}

function Get-ScenarioCounts($addonContent) {
  $counts = @{}
  $packs = Join-Path $addonContent 'scenario-packs'
  if (-not (Test-Path $packs)) { return $counts }
  foreach ($file in Get-ChildItem $packs -Filter *.json) {
    $text = [IO.File]::ReadAllText($file.FullName)
    $counts[$file.BaseName] = ([regex]::Matches($text, '"contactFrame"')).Count
  }
  return $counts
}

function Select-Maps($cs2, $addonContent) {
  $mapsDir = Join-Path $cs2 'game\csgo\maps'
  $official = @(Get-ChildItem $mapsDir -Filter '*.vpk' -ErrorAction SilentlyContinue |
    Where-Object { $_.BaseName -match '^(de|cs|ar)_[a-z0-9]+$' -and $_.BaseName -notmatch '_vanity$' } |
    ForEach-Object { $_.BaseName } | Sort-Object)
  if (-not $official.Count) { return @() }
  $counts = Get-ScenarioCounts $addonContent
  $made = Join-Path $addonContent 'maps'
  $official = @($official | Sort-Object { -1 * [int]($counts[$_]) }, { $_ })

  Step 'Which defrag maps should be made? (custom HUD + clickable menu, needs a Hammer build afterwards)'
  for ($i = 0; $i -lt $official.Count; $i++) {
    $name = $official[$i]
    $n = [int]$counts[$name]
    $label = if ($n) { "$n scenarios" } else { 'no scenarios yet' }
    $done = if (Test-Path (Join-Path $made "defrag_$name.vmap")) { ', already made' } else { '' }
    $color = if ($done) { 'DarkGray' } elseif ($n) { 'White' } else { 'DarkGray' }
    Write-Host ('    {0,2}. {1,-14} {2}{3}' -f ($i + 1), $name, $label, $done) -ForegroundColor $color
  }
  Info 'Numbers separated by commas or spaces (e.g. 1,3), "a" = every map with scenarios that isn''t made yet, Enter = none.'
  $answer = Read-Host '    Maps'
  if (-not $answer.Trim()) { return @() }
  if ($answer.Trim() -match '^[aA]') {
    return @($official | Where-Object { [int]$counts[$_] -gt 0 -and -not (Test-Path (Join-Path $made "defrag_$_.vmap")) })
  }
  $picked = foreach ($token in ($answer -split '[,\s]+' | Where-Object { $_ })) {
    if ($token -match '^\d+$' -and [int]$token -ge 1 -and [int]$token -le $official.Count) { $official[[int]$token - 1] }
    elseif ($official -contains $token) { $token }
    else { Warn "ignoring '$token'" }
  }
  return @($picked | Select-Object -Unique)
}

function Build-MapSource($cs2, $repo, $addonContent, $name) {
  $vpk = Join-Path $cs2 "game\csgo\maps\$name.vpk"
  if (-not (Test-Path $vpk)) { Warn "no $vpk, skipping $name"; return }
  $cli = Get-Decompiler
  $maps = Join-Path $addonContent 'maps'
  $source = Join-Path $maps "$name.vmap"
  $log = Join-Path $Home_ "decompile-$name.log"
  if ($RedoMap -or -not (Test-Path $source)) {
    Info "decompiling $name (takes a few minutes, log: $log)"
    $ErrorActionPreference = 'Continue'
    & $cli -i $vpk -o $addonContent -d -e 'vmap_c' --game (Join-Path $cs2 'game\csgo\gameinfo.gi') 2>&1 | Out-File $log -Encoding utf8
    $ErrorActionPreference = 'Stop'
    $nested = Join-Path $maps 'maps'
    if (Test-Path $nested) {
      Copy-Item (Join-Path $nested '*') $maps -Recurse -Force
      Remove-Item $nested -Recurse -Force
      Info 'moved the split map parts from maps\maps up into maps'
    }
    if (-not (Test-Path $source)) {
      $other = Get-ChildItem $maps -Filter "$name*.vmap" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike 'defrag_*' } | Select-Object -First 1
      if ($other) { $source = $other.FullName } else { Warn "decompiling $name produced no .vmap, see $log"; return }
    }
    Ok "decompiled to $source"
  } else {
    Ok "$source already there (-RedoMap to decompile again)"
  }

  node (Join-Path $repo 'tools\fix-decompile.ts') --content $addonContent --map ([IO.Path]::GetFileNameWithoutExtension($source))
  if ($LASTEXITCODE -ne 0) { Warn 'sorting the decompiled files into place failed' }

  $navDir = Join-Path $Home_ "nav-$name"
  $ErrorActionPreference = 'Continue'
  & $cli -i $vpk -o $navDir -e 'nav' 2>&1 | Out-File $log -Append -Encoding utf8
  $ErrorActionPreference = 'Stop'
  $nav = Get-ChildItem $navDir -Recurse -Filter '*.nav' -ErrorAction SilentlyContinue | Select-Object -First 1
  $gameMaps = Join-Path $cs2 "game\csgo_addons\$AddonName\maps"
  New-Item -ItemType Directory -Force $gameMaps | Out-Null
  if ($nav) {
    Copy-Item $nav.FullName (Join-Path $gameMaps "defrag_$name.nav") -Force
    Ok "bot nav mesh copied as defrag_$name.nav"
  } else {
    Warn "no nav mesh found in $vpk (bots may not move or shoot)"
  }

  $prefab = 'maps/' + (Split-Path $source -Leaf)
  node (Join-Path $repo 'tools\make-map.ts') --prefab $prefab --out (Join-Path $maps "defrag_$name.vmap")
  if ($LASTEXITCODE -ne 0) { throw "writing defrag_$name.vmap failed" }
}

function Compile-Scripts($cs2, $addonContent) {
  $compiler = Join-Path $cs2 'game\bin\win64\resourcecompiler.exe'
  if (-not (Test-Path $compiler)) {
    Warn "no resource compiler at ${compiler}, reinstall the Workshop Tools DLC, then run this again"
    return
  }
  $log = Join-Path $Home_ 'resourcecompiler.log'
  New-Item -ItemType Directory -Force $Home_ | Out-Null
  Set-Content $log '' -Encoding utf8
  $failed = 0
  $sources = @(Get-ChildItem (Join-Path $addonContent 'maps\scripts') -Filter *.js)
  $panorama = Join-Path $addonContent 'panorama'
  if (Test-Path $panorama) { $sources += @(Get-ChildItem $panorama -Recurse -Include *.xml, *.css) }
  foreach ($script in $sources) {
    $relative = $script.FullName.Substring($addonContent.Length).TrimStart('\')
    $extension = @{ '.js' = '.vjs_c'; '.xml' = '.vxml_c'; '.css' = '.vcss_c' }[$script.Extension]
    $compiled = Join-Path $cs2 "game\csgo_addons\$AddonName\$([IO.Path]::ChangeExtension($relative, $extension))"
    if (Test-Path $compiled) { Remove-Item $compiled -Force }
    "== $($script.FullName)" | Out-File $log -Append -Encoding utf8
    $ErrorActionPreference = 'Continue'
    & $compiler -i $script.FullName 2>&1 | Out-File $log -Append -Encoding utf8
    $ErrorActionPreference = 'Stop'
    if (Test-Path $compiled) {
      Ok "compiled $($script.Name)"
    } else {
      $failed++
      Warn "compiling $($script.Name) failed, last compiler output:"
      Get-Content $log -Tail 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
    }
  }
  if ($failed) { Warn "full log: $log" }
}

function Main {
  Write-Host 'defrag setup' -ForegroundColor White

  Step 'Finding CS2'
  $cs2 = Find-Cs2
  Ok $cs2
  $hasTools = (Test-Path (Join-Path $cs2 'content\csgo')) -or (Test-Path (Join-Path $cs2 'game\bin\win64\resourcecompiler.exe'))
  if ($hasTools) {
    Ok 'Counter-Strike 2 Workshop Tools are installed'
  } else {
    Warn 'Counter-Strike 2 Workshop Tools are missing. In Steam: Library > Counter-Strike 2 > Properties > DLC >'
    Warn 'tick "Counter-Strike 2 Workshop Tools", let it download, then run this again.'
  }

  Step 'Getting the code'
  $repo = Get-Repo

  Step 'Node and pnpm'
  $nodeDir = Get-NodeDir
  Install-Pnpm $nodeDir

  Step 'Installing dependencies'
  Push-Location $repo
  try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

    Step "Creating the '$AddonName' addon"
    $addonContent = Join-Path $cs2 "content\csgo_addons\$AddonName"
    $addonGame = Join-Path $cs2 "game\csgo_addons\$AddonName"
    New-Item -ItemType Directory -Force (Join-Path $addonContent 'maps\scripts'), $addonGame | Out-Null
    $oldScripts = Join-Path $addonContent 'scripts'
    if (Test-Path $oldScripts) { Remove-Item $oldScripts -Recurse -Force }
    Ok $addonContent

    Step 'Extracting peeks from demos'
    Extract-Scenarios $cs2 $repo $addonContent

    Step 'Building the map scripts'
    $env:CS2_ADDON_DIR = $addonContent
    pnpm --filter @defrag/addon build
    if ($LASTEXITCODE -ne 0) { throw 'building the scripts failed' }
    if ($hasTools) {
      Compile-Scripts $cs2 $addonContent
    } else {
      Warn 'scripts not compiled because the Workshop Tools are missing: run this again once they are installed'
    }
    Write-ScriptConfig $cs2 'defrag' 'crossfire' 'the crossfire trainer'
    $chosen = @($Map)
    if (-not $chosen.Count -and -not $Watch) { $chosen = @(Select-Maps $cs2 $addonContent) }
    if ($chosen.Count) {
      Step "Making the defrag map(s): $($chosen -join ', ')"
      foreach ($name in $chosen) { Build-MapSource $cs2 $repo $addonContent $name }
    }
    Write-ScriptConfig $cs2 'defrag_spike' 'spike' 'the bot peek spike'

    Step 'Done'
    foreach ($name in $chosen) {
      Info "Map defrag_${name}: in the Workshop Tools open Hammer, File > Open > maps/defrag_$name.vmap,"
      Info "  then Build (F9) with 'Build lighting' set to Fast (or off for a quick first try), then in the console: map defrag_$name"
      Info "  The map already contains the crossfire script and the custom HUD, so no exec defrag there; !menu should open the clickable menu."
    }
    Info '1. Start Counter-Strike 2 Workshop Tools and pick the defrag addon.'
    Info '2. In the console: map de_mirage   (a map you have scenarios for; any map works for your own peeks)'
    Info '3. Join a team, then in the console: exec defrag'
    Info '4. Chat says "[defrag] crossfire loaded: N scenarios". Type !menu for the clickable menu, !start, !set 20, or !help.'
    Info 'No scenarios? Stand on an angle and type !hold, walk to where the bot should come from, !rec, swing out and stop.'
    Info 'The older test script is still there: exec defrag_spike (load only one of the two per map).'
    Info "While editing the scripts, run $(Join-Path $repo 'watch.cmd') to rebuild and copy them on every save."

    if ($Watch) {
      Step 'Watching addon/src (Ctrl+C to stop)'
      pnpm --filter @defrag/addon watch
      return
    }

    if ($hasTools) {
      $start = $Launch
      if (-not $start) { $start = (Read-Host "`nStart the Workshop Tools now? [Y/n]") -notmatch '^[nN]' }
      if ($start) {
        Start-Process (Join-Path $cs2 'game\bin\win64\cs2.exe') -ArgumentList '-tools', '-addon', $AddonName
        Ok 'starting CS2 Workshop Tools'
      }
    }
  } finally {
    Pop-Location
  }
}

try {
  Main
} catch {
  Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
}
