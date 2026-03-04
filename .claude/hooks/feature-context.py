#!/usr/bin/env python3
"""
SessionStart hook — inject feature roadmap context into session.
Reads feature-roadmap.json + git log + TODO scan.
Timeout: <= 10 seconds.
"""
import json
import subprocess
import os
import sys

ROADMAP_PATH = os.path.join(os.path.dirname(__file__), '..', 'feature-roadmap.json')

def get_roadmap():
    try:
        with open(ROADMAP_PATH, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def get_recent_commits(n=5):
    try:
        result = subprocess.run(
            ['git', 'log', f'--oneline', f'-{n}'],
            capture_output=True, text=True, timeout=3
        )
        return result.stdout.strip().split('\n') if result.stdout.strip() else []
    except Exception:
        return []

def count_todos():
    try:
        result = subprocess.run(
            ['grep', '-r', '--include=*.ts', '--include=*.tsx', '-c', 'TODO\\|FIXME\\|HACK', 'src/'],
            capture_output=True, text=True, timeout=5
        )
        total = sum(int(line.split(':')[-1]) for line in result.stdout.strip().split('\n') if line and ':' in line)
        return total
    except Exception:
        return 0

def main():
    roadmap = get_roadmap()
    if not roadmap:
        print("No feature roadmap found.")
        return

    features = roadmap.get('features', [])
    by_status = {}
    for f in features:
        status = f.get('status', 'unknown')
        by_status.setdefault(status, []).append(f)

    done = len(by_status.get('done', []))
    in_progress = by_status.get('in_progress', [])
    next_up = by_status.get('next', [])
    planned = len(by_status.get('planned', []))
    blocked = len(by_status.get('blocked', []))

    print(f"Sprint: {done} done, {len(in_progress)} in-progress, {len(next_up)} next, {planned} planned, {blocked} blocked")

    if in_progress:
        print(f"Current: {', '.join(f['id'] + ' ' + f['name'] for f in in_progress)}")

    if next_up:
        print(f"Next up: {', '.join(f['id'] + ' ' + f['name'] for f in next_up[:3])}")

    commits = get_recent_commits()
    if commits:
        print(f"Recent: {commits[0]}")

    todos = count_todos()
    if todos > 0:
        print(f"TODOs in codebase: {todos}")

if __name__ == '__main__':
    main()
