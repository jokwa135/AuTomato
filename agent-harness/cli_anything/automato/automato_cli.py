"""Agent-friendly controls for the real AuTomato desktop app."""
import json
import os
import shlex
import sys
import uuid
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import click
from cli_anything.automato.utils.automato_backend import request, start, data_root


def output(value):
    click.echo(json.dumps(value, ensure_ascii=False, indent=2))


def call(command, **args):
    ctx = click.get_current_context().find_root()
    if ctx.obj.get('dry_run') and command not in ('status', 'inspect', 'assets', 'tabs', 'studios'):
        value = {'dryRun': True, 'command': command}
    else:
        try:
            value = request(command, args)
        except RuntimeError as error:
            raise click.ClickException(str(error)) from error
    output(value)
    return value


@click.group(invoke_without_command=True)
@click.option('--json', 'as_json', is_flag=True, help='Emit machine-readable JSON (also the default output format).')
@click.option('--dry-run', is_flag=True, help='Describe an action without changing the application.')
@click.version_option('0.3.2')
@click.pass_context
def cli(ctx, as_json, dry_run):
    """Control the local AuTomato app. Inspect a page before acting on element refs."""
    ctx.ensure_object(dict)
    ctx.obj.update(json=as_json, dry_run=dry_run)
    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


@cli.command('start')
@click.pass_context
def start_app(ctx):
    """Open the local desktop app; creates no cloud resources."""
    if ctx.obj['dry_run']:
        output({'dryRun': True, 'command': 'start'})
        return
    try:
        output(start())
    except RuntimeError as error:
        raise click.ClickException(str(error)) from error


@cli.command()
def status():
    """Show active studio, tabs, native bounds and data paths."""
    call('status')


@cli.command()
def studios():
    """List the available provider studios."""
    call('studios')


@cli.command()
@click.argument('studio', type=click.Choice(['higgsfield', 'flow', 'symphony', 'tiktok', 'capcut', 'clipscript', 'test']))
def switch(studio):
    """Select a studio. 'test' requires an isolated test-mode app."""
    call('switch', studio=studio)


@cli.command()
@click.option('--query', help='Filter accessible names and roles.')
@click.option('--limit', default=250, type=click.IntRange(10, 1000))
@click.option('--frame', help='Inspect one frame ID from an earlier inspection.')
def inspect(query, limit, frame):
    """Read the real accessibility tree; returns element refs for actions."""
    call('inspect', query=query, limit=limit, frame=frame)


@cli.command()
@click.argument('ref')
def click_element(ref):
    """Click one element ref returned by inspect."""
    call('click', ref=ref)


cli.add_command(click_element, 'click')
cli.commands.pop('click-element', None)


@cli.command()
@click.argument('ref')
@click.argument('text')
def fill(ref, text):
    """Replace text in an inspected field."""
    call('fill', ref=ref, text=text)


@cli.command()
@click.argument('key')
@click.option('--modifiers', default=0, type=int, help='CDP mask: Alt=1, Ctrl=2, Meta=4, Shift=8.')
def press(key, modifiers):
    """Send a keyboard key to the active website."""
    call('press', key=key, modifiers=modifiers)


@cli.command(context_settings={'ignore_unknown_options': True})
@click.argument('delta', type=int, default=600)
def scroll(delta):
    """Scroll the active website vertically in pixels (negative goes up)."""
    call('scroll', delta=delta)


@cli.command()
@click.argument('ref')
@click.argument('files', type=click.Path(exists=True, dir_okay=False, resolve_path=True), nargs=-1, required=True)
def upload(ref, files):
    """Attach local files to an inspected file input. Does not click submit."""
    call('upload', ref=ref, files=list(files))


@cli.group()
def tabs():
    """Inspect and select provider popup tabs."""


@tabs.command('list')
def list_tabs():
    call('tabs')


@tabs.command('select')
@click.argument('id', type=int)
def select_tab(id):
    call('select-tab', id=id)


@tabs.command('close')
@click.argument('id', type=int)
def close_tab(id):
    call('close-tab', id=id)


@cli.group()
def page():
    """Navigate the active native website view."""


@page.command('navigate')
@click.argument('url')
def navigate(url):
    call('navigate', url=url)


@page.command('reload')
def reload_page():
    call('reload')


@page.command('back')
def back():
    call('back')


@cli.group()
def assets():
    """Manage the shared local shelf without deleting source files."""


@assets.command('list')
def list_assets():
    call('assets')


@assets.command('import')
@click.argument('files', type=click.Path(exists=True, dir_okay=False, resolve_path=True), nargs=-1, required=True)
def import_assets(files):
    call('import', files=list(files))


@cli.command()
def storage():
    """Show the data folder selected in AuTomato Settings."""
    call('storage')


@cli.command()
@click.option('--sidebar', type=click.Choice(['show', 'hide']))
@click.option('--bottom', type=click.Choice(['show', 'hide']))
@click.option('--sidebar-width', type=click.IntRange(190, 560))
@click.option('--bottom-height', type=click.IntRange(88, 420))
@click.option('--studios-height', type=click.IntRange(44, 112))
def panels(sidebar, bottom, sidebar_width, bottom_height, studios_height):
    """Show, hide or resize workspace panels; saves the layout."""
    args = {key: value == 'show' for key, value in [('sidebar', sidebar), ('bottom', bottom)] if value}
    args.update({key: value for key, value in [('sidebarWidth', sidebar_width), ('bottomHeight', bottom_height), ('studiosHeight', studios_height)] if value is not None})
    call('panels', **args)


@cli.command()
@click.option('--mode', type=click.Choice(['system', 'light', 'dark']))
@click.option('--theme', type=click.Choice(['orchard', 'everforest', 'graphite', 'rosewood', 'nord']))
@click.option('--accent')
@click.option('--background')
@click.option('--foreground')
@click.option('--font', type=click.Choice(['Segoe UI', 'Arial', 'Georgia', 'Consolas', 'System UI']))
@click.option('--reset', is_flag=True)
def appearance(mode, theme, accent, background, foreground, font, reset):
    """Read or change local theme preferences; affects the AuTomato shell."""
    import re
    for name, color in [('accent', accent), ('background', background), ('foreground', foreground)]:
        if color is not None and not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            raise click.BadParameter('Use a six-digit hex color, for example #E87678.', param_hint='--' + name)
    args = {key: value for key, value in [('mode', mode), ('theme', theme), ('accent', accent), ('background', background), ('foreground', foreground), ('font', font)] if value is not None}
    if theme:
        for key, value in [('accent', accent), ('background', background), ('foreground', foreground)]:
            args[key] = value
    if reset:
        args['reset'] = True
    call('appearance', **args)


@cli.command()
@click.argument('path', type=click.Path(resolve_path=True))
@click.option('--shell', is_flag=True, help='Capture the app shell instead of the website view.')
def screenshot(path, shell):
    """Export a native PNG capture without image/video streaming."""
    call('screenshot', path=path, shell=shell)


@cli.group()
def preview():
    """Publish truthful native application captures as preview-bundle/v1."""


@preview.command('recipes')
def preview_recipes():
    output({'recipes': [{'id': 'website', 'source': 'Electron native WebContents.capturePage'}], 'modes': ['static']})


@preview.command('capture')
@click.option('--out', type=click.Path(resolve_path=True), help='New bundle directory; defaults to previews inside the selected data folder.')
@click.pass_context
def preview_capture(ctx, out):
    if ctx.obj['dry_run']:
        output({'dryRun': True, 'command': 'preview capture'})
        return
    bundle = Path(out) if out else data_root() / 'previews' / ('bundle-' + uuid.uuid4().hex[:12])
    if bundle.exists():
        raise click.ClickException('Bundle directory already exists; choose a new path.')
    try:
        (bundle / 'artifacts').mkdir(parents=True)
        capture = request('screenshot', {'path': str(bundle / 'artifacts/website.png')})
        state = request('status')
    except RuntimeError as error:
        raise click.ClickException(str(error)) from error
    summary = {'headline': 'Native AuTomato website capture', 'facts': {'active': state['active'], 'width': capture['width'], 'height': capture['height']}, 'warnings': []}
    fingerprint = hashlib.sha256(Path(capture['path']).read_bytes()).hexdigest()
    manifest = {
        'protocol_version': 'preview-bundle/v1', 'bundle_id': bundle.name, 'bundle_kind': 'capture',
        'software': 'automato', 'recipe': 'website', 'status': 'ok',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'generator': {'entry_point': 'cli-anything-automato', 'harness_version': '0.3.2', 'command': 'preview capture', 'backend': 'Electron WebContents.capturePage'},
        'source': {'capture_fingerprint': 'sha256:' + fingerprint, 'studio': state['active']},
        'artifacts': [{'artifact_id': 'website', 'role': 'hero', 'path': 'artifacts/website.png', 'kind': 'image', 'media_type': 'image/png', 'width': capture['width'], 'height': capture['height'], 'bytes': capture['bytes']}],
        'summary_path': 'summary.json',
    }
    (bundle / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    (bundle / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    output({'_bundle_dir': str(bundle), '_manifest_path': str(bundle / 'manifest.json'), 'summary_path': str(bundle / 'summary.json'), **capture})


@preview.command('latest')
def preview_latest():
    manifests = list((data_root() / 'previews').glob('bundle-*/manifest.json'))
    if not manifests:
        raise click.ClickException('No preview bundle. Run preview capture first.')
    latest = max(manifests, key=lambda file: file.stat().st_mtime)
    output({'_bundle_dir': str(latest.parent), '_manifest_path': str(latest)})


@cli.command()
def quit():
    """Close only the AuTomato instance selected by AUTOMATO_DATA_DIR."""
    call('quit')


@cli.command(hidden=True)
def test_state():
    call('test-state')


@cli.command()
def repl():
    """Interactive command prompt; uses the same live application session."""
    from cli_anything.automato.utils.repl_skin import ReplSkin
    # Avoid retaining typed field contents, passwords or tokens as REPL history.
    skin = ReplSkin('automato', version='0.3.2', history_file=os.devnull,
                    skill_path=str(Path(__file__).parent / 'skills/SKILL.md'))
    skin.skill_install_cmd = 'Already installed locally; no download needed'
    skin.print_banner()
    session = skin.create_prompt_session() if sys.stdin.isatty() and sys.stdout.isatty() else None
    while True:
        try:
            line = skin.get_input(session).strip()
            if line in ('exit', 'quit'):
                break
            if not line:
                continue
            if line == 'help':
                line = '--help'
            cli.main(args=shlex.split(line, posix=True), standalone_mode=False)
        except (EOFError, KeyboardInterrupt):
            break
        except (click.ClickException, click.UsageError, ValueError) as error:
            skin.error(str(error))
    skin.print_goodbye()


def main():
    # Agents can put these two global flags before or after the command.
    args = sys.argv[1:]
    prefix = [flag for flag in ('--json', '--dry-run') if flag in args]
    cli.main(args=prefix + [arg for arg in args if arg not in prefix])


if __name__ == '__main__':
    main()
