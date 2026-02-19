#!/usr/bin/env python3
# run.py - Easy launch script for Pied Piper dashboard

import app, os, threading, time, glob, tempfile

def start_dashboard():
    """Launch the enhanced dashboard cleanly."""
    base_port = 8080
    port = base_port
    
    # Find first available port
    import socket
    for p in range(base_port, base_port + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('0.0.0.0', p))
                port = p
                break
        except OSError:
            continue
    
    print(f"🚀 Starting Pied Piper dashboard on http://localhost:{port}")
    print(f"📁 Files will be stored in uploads/ directory")
    print(f"🔐 Login: piedpiper / middleout2026")
    print("---")
    
    # Clean up any old processes
    import subprocess
    subprocess.run(["pkill", "-f", "app.py"], capture_output=True)
    
    try:
        app.app.run(host='0.0.0.0', port=port, debug=False)
    except KeyboardInterrupt:
        print("\n👋 Dashboard stopped")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    import threading
    start_dashboard()