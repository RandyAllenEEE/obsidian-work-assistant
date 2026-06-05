using System;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace SMTCBridge
{
    class Program
    {
        const int FallbackPollMs = 60000;
        static readonly object Sync = new object();

        static GlobalSystemMediaTransportControlsSessionManager manager;
        static GlobalSystemMediaTransportControlsSession currentSession;
        static string lastJson = "";
        static string lastTrackId = "";
        static string lastThumbBase64 = "";
        static string thumbnailRefreshTrackId = "";
        static bool running = true;
        static bool managerEventsRegistered = false;
        static Timer fallbackTimer;

        static TypedEventHandler<GlobalSystemMediaTransportControlsSessionManager, CurrentSessionChangedEventArgs> currentSessionChangedHandler;
        static TypedEventHandler<GlobalSystemMediaTransportControlsSessionManager, SessionsChangedEventArgs> sessionsChangedHandler;
        static TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> playbackInfoChangedHandler;
        static TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> mediaPropertiesChangedHandler;
        static TypedEventHandler<GlobalSystemMediaTransportControlsSession, TimelinePropertiesChangedEventArgs> timelinePropertiesChangedHandler;

        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            if (args.Length == 0)
            {
                Console.WriteLine("Usage: SMTCBridge.exe [monitor | control <action> | poll]");
                return;
            }

            string mode = args[0].ToLower();

            if (mode == "monitor")
            {
                RunMonitor();
            }
            else if (mode == "control" && args.Length > 1)
            {
                EnsureManager();
                RunControl(args[1]);
            }
            else if (mode == "poll")
            {
                EnsureManager();
                EmitCurrent(true, true);
            }
            else
            {
                Console.WriteLine("Invalid arguments.");
            }
        }

        static bool EnsureManager()
        {
            if (manager != null) return true;

            var task = GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            manager = GetResult(task);
            return manager != null;
        }

        static void RunMonitor()
        {
            try
            {
                if (EnsureManager())
                {
                    RegisterManagerEvents();
                    BindCurrentSession();
                }
                else
                {
                    EmitNull(true);
                }

                fallbackTimer = new Timer(delegate { RefreshFromFallback(); }, null, FallbackPollMs, FallbackPollMs);

                Thread inputThread = new Thread(ReadCommands);
                inputThread.IsBackground = true;
                inputThread.Start();

                while (running)
                {
                    Thread.Sleep(1000);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.Message);
            }
            finally
            {
                if (fallbackTimer != null)
                {
                    fallbackTimer.Dispose();
                }
                UnregisterCurrentSessionEvents();
            }
        }

        static void RegisterManagerEvents()
        {
            if (manager == null || managerEventsRegistered) return;

            currentSessionChangedHandler = delegate
            {
                BindCurrentSession();
            };
            sessionsChangedHandler = delegate
            {
                BindCurrentSession();
            };

            manager.CurrentSessionChanged += currentSessionChangedHandler;
            manager.SessionsChanged += sessionsChangedHandler;
            managerEventsRegistered = true;
        }

        static void RefreshFromFallback()
        {
            if (manager == null)
            {
                if (EnsureManager())
                {
                    RegisterManagerEvents();
                    BindCurrentSession();
                    return;
                }
            }

            EmitCurrent(false, false);
        }

        static void BindCurrentSession()
        {
            lock (Sync)
            {
                UnregisterCurrentSessionEvents();
                currentSession = manager.GetCurrentSession();

                if (currentSession != null)
                {
                    playbackInfoChangedHandler = delegate { EmitCurrent(false, false); };
                    mediaPropertiesChangedHandler = delegate { EmitCurrent(false, false); };
                    timelinePropertiesChangedHandler = delegate { EmitCurrent(false, false); };

                    currentSession.PlaybackInfoChanged += playbackInfoChangedHandler;
                    currentSession.MediaPropertiesChanged += mediaPropertiesChangedHandler;
                    currentSession.TimelinePropertiesChanged += timelinePropertiesChangedHandler;
                }
            }

            EmitCurrent(true, false);
        }

        static void UnregisterCurrentSessionEvents()
        {
            if (currentSession == null) return;

            try
            {
                if (playbackInfoChangedHandler != null) currentSession.PlaybackInfoChanged -= playbackInfoChangedHandler;
                if (mediaPropertiesChangedHandler != null) currentSession.MediaPropertiesChanged -= mediaPropertiesChangedHandler;
                if (timelinePropertiesChangedHandler != null) currentSession.TimelinePropertiesChanged -= timelinePropertiesChangedHandler;
            }
            catch
            {
                // Ignore teardown races from disappearing sessions.
            }

            playbackInfoChangedHandler = null;
            mediaPropertiesChangedHandler = null;
            timelinePropertiesChangedHandler = null;
            currentSession = null;
        }

        static void ReadCommands()
        {
            while (running)
            {
                string line = Console.ReadLine();
                if (line == null)
                {
                    Thread.Sleep(100);
                    continue;
                }

                HandleCommand(line);
            }
        }

        static void HandleCommand(string line)
        {
            if (line == null) return;

            string command = line.Trim();
            if (command.Length == 0) return;

            string lower = command.ToLower();
            if (lower == "quit")
            {
                running = false;
                return;
            }

            if (lower == "poll")
            {
                EmitCurrent(true, true);
                return;
            }

            if (lower.StartsWith("control "))
            {
                string action = lower.Substring("control ".Length).Trim();
                RunControl(action);
                ScheduleControlRefreshes();
            }
        }

        static void ScheduleControlRefreshes()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(150);
                EmitCurrent(true, false);
                Thread.Sleep(650);
                EmitCurrent(true, true);
            });
        }

        static void RunControl(string action)
        {
            try
            {
                if (!EnsureManager()) return;

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

        static void EmitCurrent(bool force, bool includeThumbnail)
        {
            try
            {
                MediaInfo data = GetMediaSessionInfo(includeThumbnail);
                if (data == null)
                {
                    EmitNull(force);
                    return;
                }

                string json = EscapeJson(data);
                EmitJson(json, force);

                if (!includeThumbnail)
                {
                    QueueThumbnailRefresh(data.TrackId);
                }
            }
            catch
            {
                EmitNull(force);
            }
        }

        static void QueueThumbnailRefresh(string trackId)
        {
            if (string.IsNullOrEmpty(trackId)) return;
            if (trackId == lastTrackId && !string.IsNullOrEmpty(lastThumbBase64)) return;

            lock (Sync)
            {
                if (thumbnailRefreshTrackId == trackId) return;
                thumbnailRefreshTrackId = trackId;
            }

            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(50);
                EmitCurrent(false, true);
                lock (Sync)
                {
                    if (thumbnailRefreshTrackId == trackId)
                    {
                        thumbnailRefreshTrackId = "";
                    }
                }
            });
        }

        static void EmitNull(bool force)
        {
            EmitJson("null", force);
        }

        static void EmitJson(string json, bool force)
        {
            lock (Sync)
            {
                if (force || json != lastJson)
                {
                    Console.WriteLine("JSON_START" + json + "JSON_END");
                    Console.Out.Flush();
                    lastJson = json;
                }
            }
        }

        static MediaInfo GetMediaSessionInfo(bool includeThumbnail)
        {
            try
            {
                if (!EnsureManager()) return null;

                var session = currentSession;
                if (session == null)
                {
                    session = manager.GetCurrentSession();
                }
                if (session == null) return null;

                var propsTask = session.TryGetMediaPropertiesAsync();
                var props = GetResult(propsTask);
                if (props == null) return null;

                var playbackInfo = session.GetPlaybackInfo();
                string sourceAppId = session.SourceAppUserModelId;
                string trackId = sourceAppId + "|" + props.Title + "|" + props.Artist + "|" + props.AlbumTitle;
                string thumbBase64 = "";

                if (trackId == lastTrackId && !string.IsNullOrEmpty(lastThumbBase64))
                {
                    thumbBase64 = lastThumbBase64;
                }
                else if (includeThumbnail && props.Thumbnail != null)
                {
                    thumbBase64 = ReadThumbnail(props.Thumbnail);
                    if (!string.IsNullOrEmpty(thumbBase64))
                    {
                        lastTrackId = trackId;
                        lastThumbBase64 = thumbBase64;
                    }
                }

                return new MediaInfo
                {
                    Title = props.Title,
                    Artist = props.Artist,
                    AlbumTitle = props.AlbumTitle,
                    Status = playbackInfo.PlaybackStatus.ToString(),
                    SourceAppId = sourceAppId,
                    Thumbnail = thumbBase64,
                    TrackId = trackId
                };
            }
            catch
            {
                return null;
            }
        }

        static string ReadThumbnail(IRandomAccessStreamReference thumbnail)
        {
            try
            {
                var streamOp = thumbnail.OpenReadAsync();
                using (var stream = GetResult(streamOp))
                {
                    if (stream == null || stream.Size == 0) return "";

                    var reader = new DataReader(stream.GetInputStreamAt(0));
                    var loadOp = reader.LoadAsync((uint)stream.Size);
                    while (loadOp.Status == AsyncStatus.Started) Thread.Sleep(50);

                    if (loadOp.Status != AsyncStatus.Completed) return "";

                    byte[] bytes = new byte[stream.Size];
                    reader.ReadBytes(bytes);
                    return "data:image/jpeg;base64," + Convert.ToBase64String(bytes);
                }
            }
            catch
            {
                return "";
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

            StringBuilder builder = new StringBuilder();
            foreach (char c in s)
            {
                switch (c)
                {
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\b':
                        builder.Append("\\b");
                        break;
                    case '\f':
                        builder.Append("\\f");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        if (c < 32)
                        {
                            builder.Append("\\u");
                            builder.Append(((int)c).ToString("x4"));
                        }
                        else
                        {
                            builder.Append(c);
                        }
                        break;
                }
            }

            return builder.ToString();
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
        public string TrackId { get; set; }
    }
}
