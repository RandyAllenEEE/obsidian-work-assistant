using System;
using System.IO;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace MediaMonitor
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
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
                catch (Exception ex)
                {
                   // Console.Error.WriteLine(ex.Message);
                }

                Thread.Sleep(2000);
            }
        }

        static T GetResult<T>(IAsyncOperation<T> op)
        {
            while (op.Status == AsyncStatus.Started)
            {
                Thread.Sleep(50);
            }
            if (op.Status == AsyncStatus.Completed) return op.GetResults();
            throw new Exception("Async op failed: " + op.Status);
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

        static MediaInfo GetMediaSessionInfo()
        {
            try
            {
                var task = GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                var manager = GetResult(task);
                
                var session = manager.GetCurrentSession();
                if (session == null) return null;

                var propsTask = session.TryGetMediaPropertiesAsync();
                var props = GetResult(propsTask);
                
                var playbackInfo = session.GetPlaybackInfo();

                string thumbBase64 = "";
                if (props.Thumbnail != null)
                {
                    try
                    {
                        var streamOp = props.Thumbnail.OpenReadAsync();
                        using (var stream = GetResult(streamOp))
                        {
                            if (stream.Size > 0)
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
                    catch { }
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
