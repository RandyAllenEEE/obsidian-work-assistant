param (
    [string]$Action = "PlayPause"
)

# Load the required assembly for WinRT
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]

try {
    $task = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $awaiter = $task.GetAwaiter()
    $manager = $awaiter.GetResult()
    
    $session = $manager.GetCurrentSession()
    
    if ($session) {
        if ($Action -eq "PlayPause") {
            $session.TryTogglePlayPauseAsync().GetAwaiter().GetResult()
        } elseif ($Action -eq "Next") {
            $session.TrySkipNextAsync().GetAwaiter().GetResult()
        } elseif ($Action -eq "Previous") {
            $session.TrySkipPreviousAsync().GetAwaiter().GetResult()
        }
    }
} catch {
    Write-Error $_
}
