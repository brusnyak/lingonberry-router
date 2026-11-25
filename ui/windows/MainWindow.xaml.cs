using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace LingonberryTray;

public partial class MainWindow : Window
{
    private readonly RouterClient _client;
    private readonly DispatcherTimer _timer;
    private bool _darkMode = true;

    public MainWindow(RouterClient client)
    {
        InitializeComponent();
        _client = client;
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();
        Loaded += async (_, _) => await RefreshAsync();
        Deactivated += (_, _) => Hide();
    }

    private async Task RefreshAsync()
    {
        var snap = await _client.FetchSnapshotAsync();
        if (snap == null)
        {
            TelemetryText.Text = "daemon offline · waiting for lingonberry-core on 127.0.0.1:8799";
            return;
        }
        TelemetryText.Text =
            $"running: {snap.Overview.Running} slots  |  avg: {(snap.Overview.AvgDurationS ?? 0):F1}s  |  " +
            $"keys: {snap.Workers.Count}  |  cron jobs: {snap.Jobs.Count} ({snap.CronLive.Count} live PIDs)";
        LiveWorkersList.ItemsSource = snap.WorkersLive;
        CronJobsList.ItemsSource = snap.Jobs;
    }

    private void OnToggleTheme(object sender, RoutedEventArgs e)
    {
        _darkMode = !_darkMode;
        BtnTheme.Content = _darkMode ? "Night" : "Day";
        RootBorder.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(_darkMode ? "#12141a" : "#ffffff"));
        RootBorder.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(_darkMode ? "#262a34" : "#d4d4d8"));
    }

    private async void OnRescan(object sender, RoutedEventArgs e)
    {
        await _client.RescanAsync();
        await RefreshAsync();
    }

    private async void OnKillWorker(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: uint pid })
        {
            await _client.KillWorkerAsync(pid);
            await RefreshAsync();
        }
    }

    private async void OnToggleJob(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string name })
        {
            await _client.ToggleJobAsync(name);
            await RefreshAsync();
        }
    }

    private async void OnRunJob(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string name })
        {
            await _client.RunJobAsync(name);
            await RefreshAsync();
        }
    }

    private async void OnHealJob(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string name })
        {
            await _client.HealJobAsync(name);
            await RefreshAsync();
        }
    }

    private void OnClose(object sender, RoutedEventArgs e) => Hide();
}
