#!/usr/bin/env python3
"""Project-owned UI inventory: one `kind|name|locator` line per control."""
if __name__ == "__main__":
    print('cli|chart|chart <chart> [--json]')
    print('cli|route|route <chart> --from X,Y --to X,Y [--ascii] [--json]')
    print('cli|serve|serve [--port N] [--project DIR]')
    print('select|preset|web/index.html#preset')
    print('textarea|chart|web/index.html#chart')
    print('input|from|web/index.html#from')
    print('input|to|web/index.html#to')
    print('button|plan|web/index.html#plan')
    print('button|save|web/index.html#save')
    print('button|load|web/index.html#load')
    print('button|export|web/index.html#export')
    print('output|map|web/index.html#map')
    print('cli|help|--help')
