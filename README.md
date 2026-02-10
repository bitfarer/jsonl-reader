# JSONL Reader - Visual Studio Code Extension

A fast and efficient reader for JSON Lines (JSONL / NDJSON) files with pagination, search, and syntax highlighting.

## Features

- **Pagination**: Load large JSONL files in pages instead of all at once
- **Syntax Highlighting**: Color-coded JSON syntax for better readability
- **Search**: Full-text search across JSONL files with regex support
- **Line Navigation**: Jump to specific lines quickly
- **Statistics**: View file statistics (total lines, valid JSON, errors)
- **Copy Functionality**: Copy individual lines or entire JSON objects
- **Error Detection**: Identify and highlight malformed JSON lines

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "JSONL Reader"
4. Click Install

## Usage

### Open a JSONL File

1. **Via Command Palette**:
   - Press `Ctrl+Shift+P`
   - Type "Open JSONL File"
   - Select your `.jsonl` or `.ndjson` file

2. **Via Right-Click**:
   - Right-click on any `.jsonl` or `.ndjson` file in the Explorer
   - Select "Open with JSONL Reader"

3. **Via File Association**:
   - The extension automatically opens `.jsonl` and `.ndjson` files by default

### Interface Overview

The JSONL Reader provides a custom editor with:

- **Toolbar**: Search, navigation, and settings
- **Line List**: Paginated view of JSONL lines with expandable details
- **Search Panel**: Search results and navigation
- **Pagination Controls**: Navigate through pages of lines
- **Statistics Display**: File size, line counts, and error counts

### Keyboard Shortcuts

- `Ctrl+F` / `Cmd+F`: Focus search input
- `Ctrl+G` / `Cmd+G`: Go to line
- `Ctrl+C` / `Cmd+C`: Copy selected line (when focused)
- `Enter`: Expand/collapse line details

## Configuration

The extension can be configured via VS Code settings:

- `jsonlReader.pageSize`: Number of lines per page (default: 100)
- `jsonlReader.maxSearchResults`: Maximum search results (default: 1000)
- `jsonlReader.useAsDefault`: Use as default editor for JSONL files (default: true)

## Supported File Formats

- `.jsonl` - JSON Lines format
- `.ndjson` - Newline Delimited JSON format

## Requirements

- VS Code version 1.109.0 or higher

## Known Issues

- Very large files (10GB+) may have slower indexing
- Search may be slower on very large files

## Release Notes

### 0.0.1

Initial release of JSONL Reader:
- Basic JSONL file viewing with pagination
- Search functionality with regex support
- Syntax highlighting for JSON
- File statistics display
- Copy functionality for lines

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details
