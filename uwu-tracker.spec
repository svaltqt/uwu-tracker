# -*- mode: python ; coding: utf-8 -*-
#
# Spec de PyInstaller para empaquetar uwu-tracker como ejecutable standalone
# (un solo archivo, sin necesidad de Python ni de instalar nada más).
#
# Uso local:
#   pip install pyinstaller
#   pyinstaller uwu-tracker.spec
#   -> el ejecutable queda en dist/uwu-tracker(.exe)
#
# En CI (recomendado, no hace falta tener Windows/Mac a mano):
#   ver .github/workflows/build.yml — corre este mismo spec en runners de
#   Windows, macOS y Linux y deja los 3 binarios como artifacts/release.
#
# La base de datos del roster (uwu_logs.db) NO viaja acá adentro. Vive en
# una carpeta de datos de usuario fuera del bundle (ver _user_data_dir() en
# proxy_server.py), así que reemplazar este .exe por una versión nueva
# nunca borra ni pisa el roster guardado.

a = Analysis(
    ['proxy_server.py'],
    pathex=[],
    binaries=[],
    datas=[('web', 'web')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='uwu-tracker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
