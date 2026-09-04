# Multica Desktop 内网更新服务

本包用于在 `10.0.37.30:8090` 提供 Windows Desktop 自动更新。包内已经包含当前版本的安装程序、`latest.yml` 和 blockmap，部署后即可进行更新检查。

## Linux 服务器

```bash
chmod +x install-linux.sh publish-windows-release.sh
sudo ./install-linux.sh
curl http://127.0.0.1:8090/healthz
curl http://127.0.0.1:8090/windows/x64/latest.yml
```

同时确认服务器防火墙允许内网客户端访问 TCP `8090` 端口。

## Windows 服务器

以管理员身份打开 PowerShell，在解压目录执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows.ps1
Invoke-RestMethod http://127.0.0.1:8090/healthz
Invoke-WebRequest http://127.0.0.1:8090/windows/x64/latest.yml
```

安装脚本会创建开机任务和 TCP `8090` 入站防火墙规则。

## 发布后续版本

把 GitHub Actions 下载的 Windows Desktop artifact 传到服务器，然后执行对应脚本。脚本会先复制安装程序和 blockmap，最后原子替换 `latest.yml`，避免客户端读取到不完整版本。

Linux：

```bash
sudo ./publish-windows-release.sh /path/to/desktop-artifact
```

Windows：

```powershell
.\publish-windows-release.ps1 -SourceDir D:\path\to\desktop-artifact
```

Desktop 在启动 5 秒后检查一次，运行期间每小时检查一次。首次使用内网更新源时，需要手动安装本包附带的 Desktop；从下一版本开始即可自动检查并下载。
