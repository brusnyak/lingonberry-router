using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows;
using Forms = System.Windows.Forms;

namespace LingonberryTray;

public partial class App : System.Windows.Application
{
    private Forms.NotifyIcon? _trayIcon;
    private MainWindow? _popover;
    private Process? _coreProcess;
    private readonly RouterClient _client = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        EnsureCoreDaemon();

        _popover = new MainWindow(_client);

        _trayIcon = new Forms.NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Lingonberry Router (127.0.0.1:8799)",
            Visible = true
        };

        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Open Popover", null, (_, _) => TogglePopover());
        menu.Items.Add("Rescan OS Crons & Agents", null, async (_, _) => await _client.RescanAsync());
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => ExitApp());
        _trayIcon.ContextMenuStrip = menu;
        _trayIcon.MouseClick += (_, args) =>
        {
            if (args.Button == Forms.MouseButtons.Left)
            {
                TogglePopover();
            }
        };
    }

    private void EnsureCoreDaemon()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "lingonberry-core",
                Arguments = "serve 127.0.0.1:8799",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            _coreProcess = Process.Start(psi);
        }
        catch
        {
            // Core daemon may already be running or installed globally later
        }
    }

    private void TogglePopover()
    {
        if (_popover == null) return;
        if (_popover.IsVisible)
        {
            _popover.Hide();
            return;
        }

        var workArea = SystemParameters.WorkArea;
        _popover.Left = workArea.Right - _popover.Width - 12;
        _popover.Top = workArea.Bottom - _popover.Height - 12;
        _popover.Show();
        _popover.Activate();
    }

    public void ExitApp()
    {
        if (_trayIcon != null)
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
        }
        try
        {
            if (_coreProcess != null && !_coreProcess.HasExited)
            {
                _coreProcess.Kill(true);
            }
        }
        catch { }
        Shutdown();
    }
}
