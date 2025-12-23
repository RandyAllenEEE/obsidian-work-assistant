using System;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;

namespace MediaControl
{
    class Program
    {
        static void Main(string[] args)
        {
            string action = "PlayPause";
            if (args.Length > 0)
            {
                action = args[0];
            }

            try
            {
                var task = GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                var manager = GetResult(task);
                if (manager != null)
                {
                    var session = manager.GetCurrentSession();

                    if (session != null)
                    {
                        switch (action)
                        {
                            case "PlayPause":
                                GetResult(session.TryTogglePlayPauseAsync());
                                break;
                            case "Next":
                                GetResult(session.TrySkipNextAsync());
                                break;
                            case "Previous":
                                GetResult(session.TrySkipPreviousAsync());
                                break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
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
        
        static bool GetResult(IAsyncOperation<bool> op)
        {
            while (op.Status == AsyncStatus.Started)
            {
                Thread.Sleep(50);
            }
            if (op.Status == AsyncStatus.Completed) return op.GetResults();
            throw new Exception("Async op failed: " + op.Status);
        }
    }
}
