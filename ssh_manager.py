import asyncio
import asyncssh
from typing import Dict, List, Optional, Tuple
import datetime
import socket
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



class SSHManager:
    def __init__(self):
        self.connections: Dict[str, asyncssh.SSHClientConnection] = {}
        self.lock = asyncio.Lock()

    async def get_connection(self, host: str, port: int, username: str,
                             password: str) -> Optional[
        asyncssh.SSHClientConnection]:
        key = f"{host}:{port}:{username}"

        async with self.lock:
            if key in self.connections:
                conn = self.connections[key]
                try:
                    # Проверяем, что соединение еще живо
                    await conn.run("echo test", timeout=2)
                    return conn
                except:
                    # Соединение мертво, удаляем из кэша
                    del self.connections[key]

            try:
                conn = await asyncssh.connect(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    known_hosts=None,
                    login_timeout=10,
                    connect_timeout=10
                )
                self.connections[key] = conn
                return conn
            except Exception as e:
                print(f"SSH connection error to {host}:{port}: {e}")
                return None

    async def get_processes_from_machine(self, host: str, port: int,
                                         username: str,
                                         password: str,
                                         process_filter: str = None) -> List[
        Dict]:
        """
        Получение списка процессов с машины через SSH
        """
        try:
            conn = await self.get_connection(host, port, username, password)
            if not conn:
                return []

            # Базовая команда для получения процессов
            if process_filter:
                # Фильтруем по имени процесса
                command = f"ps aux | grep -i '{process_filter}' | grep -v grep"
            else:
                # Все процессы пользователя
                command = "ps aux"

            result = await conn.run(command, timeout=10)

            if result.exit_status != 0:
                return []

            processes = []
            lines = result.stdout.strip().split('\n')

            for line in lines:
                if not line.strip():
                    continue

                parts = line.split()
                if len(parts) >= 11:
                    try:
                        process_info = {
                            'user': parts[0],
                            'pid': int(parts[1]),
                            'cpu': parts[2],
                            'mem': parts[3],
                            'vsz': parts[4],
                            'rss': parts[5],
                            'tty': parts[6],
                            'stat': parts[7],
                            'start': parts[8],
                            'time': parts[9],
                            'command': ' '.join(parts[10:]),
                            'machine_host': host
                        }
                        processes.append(process_info)
                    except (ValueError, IndexError):
                        continue

            return processes

        except Exception as e:
            logger.error(f"Error getting processes from {host}: {e}")
            return []

    async def test_connection(self, host: str, port: int, username: str,
                              password: str) -> Tuple[bool, str]:
        try:
            async with asyncssh.connect(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    known_hosts=None,
                    login_timeout=10,
                    connect_timeout=10
            ) as conn:
                result = await conn.run("echo 'SSH connection successful'",
                                        timeout=5)
                if result.exit_status == 0:
                    return True, "Connection successful"
                else:
                    return False, f"Command failed: {result.stderr}"
        except asyncio.TimeoutError:
            return False, "Connection timeout"
        except asyncssh.PermissionDenied:
            return False, "Permission denied (wrong username/password)"
        except asyncssh.Error as e:
            return False, f"SSH error: {str(e)}"
        except Exception as e:
            return False, f"Connection error: {str(e)}"

    async def execute_command(self, host: str, port: int, username: str,
                              password: str,
                              command: str) -> Tuple[bool, str, str]:
        try:
            conn = await self.get_connection(host, port, username, password)
            if not conn:
                return False, "", "Failed to establish connection"

            result = await conn.run(command, timeout=30)
            return result.exit_status == 0, result.stdout, result.stderr
        except asyncio.TimeoutError:
            return False, "", "Command execution timeout"
        except Exception as e:
            return False, "", f"Error: {str(e)}"

    async def execute_script(self, host: str, port: int, username: str,
                             password: str,
                             script_content: str) -> Tuple[bool, str, str]:
        try:
            conn = await self.get_connection(host, port, username, password)
            if not conn:
                return False, "", "Failed to establish connection"

            # Сохраняем скрипт во временный файл и выполняем
            temp_script = f"/tmp/script_{datetime.datetime.now().timestamp()}.sh"
            command = f"""
cat > {temp_script} << 'EOF'
{script_content}
EOF
chmod +x {temp_script}
nohup {temp_script} > /dev/null 2>&1 &
rm -f {temp_script}
"""


            # Выполняем созданный временный скрипт (nohup) и оставляем его в фоне
            result = await conn.run(command, timeout=300)
            return result.exit_status == 0, result.stdout, result.stderr
        except asyncio.TimeoutError:
            return False, "", "Script execution timeout"
        except Exception as e:
            return False, "", f"Error: {str(e)}"

    async def get_processes(self, host: str, port: int, username: str,
                            password: str) -> List[Dict]:
        try:
            conn = await self.get_connection(host, port, username, password)
            if not conn:
                return []

            # Получаем процессы текущего пользователя
            result = await conn.run(
                "ps aux | grep -E '^'$USER'|^'$(whoami) | grep -v grep",
                timeout=10)

            processes = []
            if result.exit_status == 0:
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 11:
                        pid = int(parts[1])
                        command = ' '.join(parts[10:])
                        processes.append({
                            'pid': pid,
                            'command': command,
                            'user': parts[0],
                            'cpu': parts[2],
                            'mem': parts[3]
                        })

            return processes
        except Exception as e:
            print(f"Error getting processes from {host}: {e}")
            return []

    async def kill_process(self, host: str, port: int, username: str,
                           password: str,
                           pid: int) -> Tuple[bool, str]:
        try:
            conn = await self.get_connection(host, port, username, password)
            if not conn:
                return False, "Failed to establish connection"

            result = await conn.run(f"kill -9 {pid}", timeout=10)
            return result.exit_status == 0, result.stderr
        except Exception as e:
            return False, str(e)

    async def remove_connection(self, host: str, port: int, username: str):
        """Удаление отдельного соединения из кэша (если есть)"""
        key = f"{host}:{port}:{username}"
        async with self.lock:
            conn = self.connections.get(key)
            if conn:
                try:
                    conn.close()
                    if hasattr(conn, 'wait_closed'):
                        try:
                            await conn.wait_closed()
                        except Exception:
                            pass
                except Exception:
                    pass
                try:
                    del self.connections[key]
                except KeyError:
                    pass

    async def close_all(self):
        async with self.lock:
            for key, conn in list(self.connections.items()):
                try:
                    conn.close()
                    if hasattr(conn, 'wait_closed'):
                        try:
                            await conn.wait_closed()
                        except Exception:
                            pass
                except:
                    pass
            self.connections.clear()


    def get_current_machine_address(self) -> str:
        """Получаем адрес текущей машины"""
        try:
            # Получаем имя хоста
            hostname = socket.gethostname()
            # Получаем IP адрес
            ip_address = socket.gethostbyname(hostname)
            return ip_address
        except:
            return "127.0.0.1"


async def test_connection(host: str, port: int, username: str,
                          password: str) -> Tuple[bool, str]:
    """Тестирование SSH подключения"""
    try:
        # Логируем попытку подключения (без пароля)
        logger.info(
            f"Testing SSH connection to {host}:{port} with user {username}")

        # Пытаемся подключиться
        async with asyncssh.connect(
                host=host,
                port=port,
                username=username,
                password=password,
                known_hosts=None,
                # Игнорируем проверку known_hosts для тестирования
                login_timeout=10,  # Таймаут логина 10 секунд
                connect_timeout=10,  # Таймаут подключения 10 секунд
                config=None  # Не используем SSH конфиг
        ) as conn:
            # Выполняем простую команду для проверки
            result = await conn.run("echo 'SSH connection test successful'",
                                    timeout=5)

            if result.exit_status == 0:
                logger.info(f"SSH connection to {host}:{port} successful")
                return True, "SSH connection successful"
            else:
                logger.warning(
                    f"SSH connection to {host}:{port} failed: {result.stderr}")
                return False, f"Command failed: {result.stderr.strip()}"

    except asyncio.TimeoutError:
        logger.warning(f"SSH connection to {host}:{port} timeout")
        return False, "Connection timeout (10 seconds)"

    except asyncssh.PermissionDenied:
        logger.warning(
            f"SSH permission denied to {host}:{port} user {username}")
        return False, "Permission denied (wrong username or password)"

    except asyncssh.ConnectionLost:
        logger.warning(f"SSH connection lost to {host}:{port}")
        return False, "Connection lost during handshake"

    except asyncssh.Error as e:
        logger.warning(f"SSH error to {host}:{port}: {str(e)}")
        return False, f"SSH error: {str(e)}"

    except socket.gaierror:
        logger.warning(f"Host {host} not found or DNS error")
        return False, f"Host {host} not found or DNS error"

    except ConnectionRefusedError:
        logger.warning(f"Connection refused to {host}:{port}")
        return False, f"Connection refused to {host}:{port}"

    except Exception as e:
        logger.error(
            f"Unexpected error testing connection to {host}:{port}: {e}")
        return False, f"Connection error: {str(e)}"


ssh_manager = SSHManager()