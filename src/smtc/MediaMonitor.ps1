# Powershell script to get System Media Transport Controls info
# Designed to be called by Node.js spawn

# Load the required assembly for WinRT
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]

$lastJson = ""

function Get-MediaSessionInfo {
    try {
        $task = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
        $awaiter = $task.GetAwaiter()
        $manager = $awaiter.GetResult()
        
        $session = $manager.GetCurrentSession()
        
        if ($session) {
            $infoTask = $session.TryGetMediaPropertiesAsync()
            $infoAwaiter = $infoTask.GetAwaiter()
            $props = $infoAwaiter.GetResult()
            
            $playbackInfo = $session.GetPlaybackInfo()
            
            $thumbnailBase64 = ""
            if ($props.Thumbnail) {
                try {
                    $thumbStream = $props.Thumbnail.OpenReadAsync().GetAwaiter().GetResult()
                    $size = $thumbStream.Size
                    if ($size -gt 0) {
                        $reader = [Windows.Storage.Streams.DataReader]::new($thumbStream)
                        $reader.LoadAsync($size).GetAwaiter().GetResult()
                        $bytes = [byte[]]::new($size)
                        $reader.ReadBytes($bytes)
                        $thumbnailBase64 = [Convert]::ToBase64String($bytes)
                        $thumbnailBase64 = "data:image/jpeg;base64," + $thumbnailBase64
                    }
                } catch {
                    # Ignore thumbnail errors
                    $thumbnailBase64 = ""
                }
            }

            $result = @{
                "Title" = if ($props.Title) { $props.Title } else { "" }
                "Artist" = if ($props.Artist) { $props.Artist } else { "" }
                "AlbumTitle" = if ($props.AlbumTitle) { $props.AlbumTitle } else { "" }
                "Status" = $playbackInfo.PlaybackStatus.ToString()
                "SourceAppId" = $session.SourceAppUserModelId
                "Thumbnail" = $thumbnailBase64
            }
            
            return $result
        } else {
            return $null
        }
    } catch {
        return $null
    }
}

# Polling Loop
while ($true) {
    $data = Get-MediaSessionInfo
    
    if ($data) {
        $json = $data | ConvertTo-Json -Compress
        # Only output if changed
        if ($json -ne $lastJson) {
            Write-Output "JSON_START$json`JSON_END"
            $lastJson = $json
        }
    } else {
        if ($lastJson -ne "null") {
             Write-Output "JSON_STARTnullJSON_END"
             $lastJson = "null"
        }
    }
    
    # Sleep to prevent high CPU usage (Performance constraint)
    Start-Sleep -Seconds 2
}
