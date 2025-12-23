# Robust setup script to compile SMTCBridge.exe
# Usage: .\setup.ps1
# Usage from node: spawn('powershell', ['-File', 'setup.ps1'])

$ErrorActionPreference = "Stop"

function Find-CSC {
    $frameworkPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
    if (-not (Test-Path $frameworkPath)) {
        $frameworkPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319"
    }
    
    $csc = Join-Path $frameworkPath "csc.exe"
    if (Test-Path $csc) {
        return $csc
    }
    throw "C# Compiler (csc.exe) not found."
}

function Find-WinMetadata {
    $paths = @(
        "C:\Windows\System32\WinMetadata",
        "C:\Program Files (x86)\Windows Kits\10\UnionMetadata",
        "C:\Program Files (x86)\Windows Kits\8.1\References\CommonConfiguration\Neutral"
    )

    foreach ($p in $paths) {
        if (Test-Path "$p\Windows.Media.winmd") {
            return $p
        }
    }
    
    # Fallback search
    $found = Get-ChildItem -Path C:\Windows\System32 -Filter "Windows.Media.winmd" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        return $found.DirectoryName
    }

    throw "Windows Metadata (winmd) not found."
}

function Find-FacadeAssembly {
    param($Name)
    $searchPaths = @(
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319",
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\Facades",
        "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\Facades",
        "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.7.2\Facades"
    )
    
    foreach ($path in $searchPaths) {
        $fullPath = Join-Path $path $Name
        if (Test-Path $fullPath) {
            return $fullPath
        }
    }
    return $null
}

try {
    Write-Host "Locating Compiler..."
    $csc = Find-CSC
    Write-Host "Found CSC: $csc"

    Write-Host "Locating Windows Metadata..."
    $winmdPath = Find-WinMetadata
    Write-Host "Found WinMD Path: $winmdPath"

    $frameworkPath = Split-Path $csc -Parent
    
    # Core References
    $refMedia = Join-Path $winmdPath "Windows.Media.winmd"
    $refFoundation = Join-Path $winmdPath "Windows.Foundation.winmd"
    $refStorage = Join-Path $winmdPath "Windows.Storage.winmd"
    
    $refRuntime = Join-Path $frameworkPath "System.Runtime.WindowsRuntime.dll"
    if (-not (Test-Path $refRuntime)) { throw "System.Runtime.WindowsRuntime.dll not found." }
    
    $refInterop = Join-Path $frameworkPath "System.Runtime.InteropServices.WindowsRuntime.dll"
    if (-not (Test-Path $refInterop)) { 
        # Optional, sometimes strictly needed, sometimes not
        Write-Warning "System.Runtime.InteropServices.WindowsRuntime.dll not found (might be ok)"
    }

    # Facade References (Needed for .NET 4.x using WinRT)
    $facadeRuntime = Find-FacadeAssembly "System.Runtime.dll"
    if (-not $facadeRuntime) { $facadeRuntime = Join-Path $frameworkPath "System.Runtime.dll" }

    $refs = "/r:`"$refMedia`" /r:`"$refFoundation`" /r:`"$refStorage`" /r:`"$refRuntime`""
    
    if ($refInterop -and (Test-Path $refInterop)) {
        $refs += " /r:`"$refInterop`""
    }
    
    if ($facadeRuntime -and (Test-Path $facadeRuntime)) {
        $refs += " /r:`"$facadeRuntime`""
    }
    
    # Compile
    $src = "SMTCBridge.cs"
    $out = "SMTCBridge.exe"
    
    if (Test-Path $out) { Remove-Item $out -Force }
    
    Write-Host "Compiling $src..."
    $cmd = "& `"$csc`" /target:exe /out:$out $refs $src"
    Invoke-Expression $cmd
    
    if (Test-Path $out) {
        Write-Host "Compilation Success: $out"
        Exit 0
    } else {
        throw "Compilation Failed (Output file not created)"
    }

} catch {
    Write-Error "Setup Failed: $($_.Exception.Message)"
    Exit 1
}
