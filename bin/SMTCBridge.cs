using System;
using System.IO;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace SMTCBridge
{
    class Program
    {
        static string lastTrackId = "";
        static string lastThumbBase64 = "";

        // ... Main and RunControl methods remain same ...

        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;

            if (args.Length == 0)
            {
                Console.WriteLine("Usage: SMTCBridge.exe [monitor | control <action>]");
                return;
            }

            string mode = args[0].ToLower();

            if (mode == "monitor")
            {
                RunMonitor();
            }
            else if (mode == "control" && args.Length > 1)
            {
                RunControl(args[1]);
            }
            else
            {
                Console.WriteLine("Invalid arguments.");
            }
        }

        static void RunControl(string action)
        {
            try
            {
                var task = GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                var manager = GetResult(task);
                if (manager == null) return;

                var session = manager.GetCurrentSession();
                if (session == null) return;

                switch (action.ToLower())
                {
                    case "playpause":
                        GetResult(session.TryTogglePlayPauseAsync());
                        break;
                    case "play":
                        GetResult(session.TryPlayAsync());
                        break;
                    case "pause":
                        GetResult(session.TryPauseAsync());
                        break;
                    case "next":
                        GetResult(session.TrySkipNextAsync());
                        break;
                    case "previous":
                    case "prev":
                        GetResult(session.TrySkipPreviousAsync());
                        break;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.Message);
            }
        }

        static void RunMonitor()
        {
            string lastJson = "";

            while (true)
            {
                try
                {
                    var data = GetMediaSessionInfo();
                    
                    if (data != null)
                    {
                        string json = EscapeJson(data);
                        if (json != lastJson)
                        {
                            Console.WriteLine("JSON_START" + json + "JSON_END");
                            lastJson = json;
                        }
                    }
                    else
                    {
                        if (lastJson != "null")
                        {
                            Console.WriteLine("JSON_STARTnullJSON_END");
                            lastJson = "null";
                        }
                    }
                }
                catch
                {
                    // Ignore transient errors
                }

                Thread.Sleep(2000); // Poll every 2 seconds
            }
        }

        static MediaInfo GetMediaSessionInfo()
        {
            try
            {
                var task = GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                var manager = GetResult(task);
                if (manager == null) return null;

                var session = manager.GetCurrentSession();
                if (session == null) return null;

                var propsTask = session.TryGetMediaPropertiesAsync();
                var props = GetResult(propsTask);
                if (props == null) return null;

                var playbackInfo = session.GetPlaybackInfo();
                
                // Caching Logic
                string currentTrackId = props.Title + "|" + props.Artist;
                string thumbBase64 = "";

                if (currentTrackId == lastTrackId && !string.IsNullOrEmpty(lastThumbBase64))
                {
                    // Reuse cached thumbnail if track hasn't changed
                    thumbBase64 = lastThumbBase64;
                }
                else
                {
                    // New track or forced refresh
                    if (props.Thumbnail != null)
                    {
                        try
                        {
                            var streamOp = props.Thumbnail.OpenReadAsync();
                            using (var stream = GetResult(streamOp))
                            {
                                if (stream != null && stream.Size > 0)
                                {
                                    var reader = new DataReader(stream.GetInputStreamAt(0));
                                    var loadOp = reader.LoadAsync((uint)stream.Size);
                                    while (loadOp.Status == AsyncStatus.Started) Thread.Sleep(50);

                                    byte[] bytes = new byte[stream.Size];
                                    reader.ReadBytes(bytes);
                                    thumbBase64 = "data:image/jpeg;base64," + Convert.ToBase64String(bytes);
                                }
                            }
                        }
                        catch { 
                            thumbBase64 = ""; 
                        }
                    }
                    
                    // Update Cache
                    lastTrackId = currentTrackId;
                    lastThumbBase64 = thumbBase64;
                }

                return new MediaInfo
                {
                    Title = props.Title,
                    Artist = props.Artist,
                    AlbumTitle = props.AlbumTitle,
                    Status = playbackInfo.PlaybackStatus.ToString(),
                    SourceAppId = session.SourceAppUserModelId,
                    Thumbnail = thumbBase64
                };
            }
            catch
            {
                return null;
            }
        }

        static T GetResult<T>(IAsyncOperation<T> op)
        {
            int timeout = 0;
            while (op.Status == AsyncStatus.Started && timeout < 40)
            {
                Thread.Sleep(50);
                timeout++;
            }
            if (op.Status == AsyncStatus.Completed) return op.GetResults();
            return default(T);
        }

        static bool GetResult(IAsyncOperation<bool> op)
        {
            int timeout = 0;
            while (op.Status == AsyncStatus.Started && timeout < 40)
            {
                Thread.Sleep(50);
                timeout++;
            }
            if (op.Status == AsyncStatus.Completed) return op.GetResults();
            return false;
        }

        static string EscapeJson(MediaInfo info)
        {
            return "{" +
                   "\"Title\": \"" + Escape(info.Title) + "\", " +
                   "\"Artist\": \"" + Escape(info.Artist) + "\", " +
                   "\"AlbumTitle\": \"" + Escape(info.AlbumTitle) + "\", " +
                   "\"Status\": \"" + Escape(info.Status) + "\", " +
                   "\"SourceAppId\": \"" + Escape(info.SourceAppId) + "\", " +
                   "\"Thumbnail\": \"" + Escape(info.Thumbnail) + "\"" +
                   "}";
        }

        static string Escape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "");
        }
    }

    class MediaInfo
    {
        public string Title { get; set; }
        public string Artist { get; set; }
        public string AlbumTitle { get; set; }
        public string Status { get; set; }
        public string SourceAppId { get; set; }
        public string Thumbnail { get; set; }
    }
}
