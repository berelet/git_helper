# Git Helper Extension

A VS Code extension that adds a Git Outgoing View to the Source Control panel, showing outgoing commits and changed files.

## Features

- Shows outgoing commits (commits that exist in your local branch but not in the remote)
- Displays changed files in a tree view
- Click on commits to view their details
- Click on files to open them in the editor
- Automatic refresh when the git repository changes
- Manual refresh button available

## Requirements

- VS Code 1.85.0 or higher
- Git repository in the workspace

## Installation

1. Clone this repository
2. Run `npm install`
3. Press F5 to start debugging

## Usage

1. Open a Git repository in VS Code
2. The Git Outgoing View will appear in the Source Control panel
3. Expand the sections to see outgoing commits and changed files
4. Click on commits to view their details
5. Click on files to open them in the editor
6. Use the refresh button to manually update the view

## Development

- `npm install` - Install dependencies
- `npm run compile` - Compile the extension
- `npm run watch` - Watch for changes and compile
- `F5` - Start debugging

## License

MIT 