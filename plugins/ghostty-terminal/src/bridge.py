# Runs the login shell on a PTY for a Buzz plugin. Reads no arguments.
# stdin: "d <base64>" input, "r <cols> <rows>" resize. stdout: base64 lines. EOF or SIGTERM hangs up the shell.
import base64, fcntl, os, pty, pwd, select, signal, struct, termios
KEEP = 'HOME USER LOGNAME LANG LC_ALL LC_CTYPE TZ TMPDIR PATH TERM COLORTERM TERM_PROGRAM BUZZ_VERSION BUZZ_CHANNEL_ID BUZZ_CHANNEL BUZZ_NPUB BUZZ_RELAY_URL BUZZ_THREAD_ID'.split()
shell = pwd.getpwuid(os.getuid()).pw_shell
env = {k: v for k, v in os.environ.items() if k in KEEP}
env['SHELL'] = shell
pid, fd = pty.fork()
if pid == 0:
    os.execve(shell, [shell, '-l'], env)
os.set_blocking(fd, False)

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

def output(data):
    os.write(1, base64.b64encode(data) + b'\n')

def finish(status):
    # The shell is gone: pass on what it last printed, then its status (128+N after signal N, as shells say it).
    signal.alarm(0)
    try:
        while data := os.read(fd, 65536):
            output(data)
    except OSError:
        pass
    code = os.waitstatus_to_exitcode(status)
    os._exit(128 - code if code < 0 else code)

def stop(*_):
    # SIGHUP the shell (it HUPs its jobs), SIGKILL after 2 s.
    signal.signal(signal.SIGALRM, lambda *_: os.killpg(pid, signal.SIGKILL))
    signal.alarm(2)
    try:
        os.killpg(pid, signal.SIGHUP)
    except OSError:
        pass
    finish(os.waitpid(pid, 0)[1])

signal.signal(signal.SIGTERM, stop)
resize(80, 24)
buf = queue = b''
while True:
    readable, writable, _ = select.select([fd, 0], [fd] * bool(queue), [], 0.25)
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        finish(status)  # also when a background job still holds the terminal open
    if fd in readable:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            stop()
        output(data)
    if 0 in readable:
        data = os.read(0, 65536)
        if not data:
            stop()
        buf += data
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            if line[:1] == b'r':
                resize(*map(int, line[2:].split()))
            else:
                queue += base64.b64decode(line[2:])
    if writable:
        try:
            queue = queue[os.write(fd, queue):]
        except BlockingIOError:
            pass
