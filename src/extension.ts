import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

class GitOutgoingItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType?: string,
        public readonly file?: string,
        public readonly status?: string,
        public readonly hash?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
    }
}

class PushStateTracker {
    private lastPushHash: string | null = null;

    async updateLastPushHash(workspaceRoot: string): Promise<void> {
        try {
            // Get the current branch
            const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot });
            const branch = currentBranch.trim();
            console.log('Current branch for push tracking:', branch);

            // Get the commit hash where the current branch diverged from origin
            const { stdout } = await execAsync(
                `git merge-base origin/${branch} ${branch}`,
                { cwd: workspaceRoot }
            );
            this.lastPushHash = stdout.trim();
            console.log('Updated last push hash:', this.lastPushHash);
        } catch (error) {
            console.error('Error getting last push hash:', error);
            this.lastPushHash = null;
        }
    }

    getLastPushHash(): string | null {
        return this.lastPushHash;
    }
}

class GitOutgoingProvider implements vscode.TreeDataProvider<GitOutgoingItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GitOutgoingItem | undefined | null | void> = new vscode.EventEmitter<GitOutgoingItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GitOutgoingItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private pushStateTracker: PushStateTracker;

    constructor(private workspaceRoot: string | undefined) {
        console.log('GitOutgoingProvider initialized with workspace:', workspaceRoot);
        this.pushStateTracker = new PushStateTracker();
        if (workspaceRoot) {
            this.pushStateTracker.updateLastPushHash(workspaceRoot);
        }
    }

    refresh(): void {
        console.log('Refreshing Git Outgoing View');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitOutgoingItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GitOutgoingItem): Promise<GitOutgoingItem[]> {
        if (!this.workspaceRoot) {
            console.log('No workspace root found');
            return Promise.resolve([]);
        }

        if (!element) {
            console.log('Creating root items');
            return [
                new GitOutgoingItem('📦 Outgoing Commits', vscode.TreeItemCollapsibleState.Expanded),
                new GitOutgoingItem('📄 Changed Files', vscode.TreeItemCollapsibleState.Expanded),
                new GitOutgoingItem('✅ Synced Commits', vscode.TreeItemCollapsibleState.Expanded),
                new GitOutgoingItem('📋 Synced Files', vscode.TreeItemCollapsibleState.Expanded)
            ];
        }

        if (element.label === '📦 Outgoing Commits') {
            console.log('Getting outgoing commits');
            return this.getOutgoingCommits();
        } else if (element.label === '📄 Changed Files') {
            console.log('Getting changed files');
            return this.getChangedFiles();
        } else if (element.label === '✅ Synced Commits') {
            console.log('Getting synced commits');
            return this.getSyncedCommits();
        } else if (element.label === '📋 Synced Files') {
            console.log('Getting synced files');
            return this.getSyncedFiles();
        }

        return [];
    }

    private async getOutgoingCommits(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            console.log('Current branch:', currentBranch);
            
            if (!this.workspaceRoot) {
                console.log('No workspace root found');
                return [];
            }

            // Check if we're in a git repository
            try {
                await execAsync('git rev-parse --is-inside-work-tree', { cwd: this.workspaceRoot });
            } catch (error) {
                console.error('Not a git repository:', error);
                return [new GitOutgoingItem('Not a git repository', vscode.TreeItemCollapsibleState.None)];
            }

            // Check if we have a remote
            try {
                const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: this.workspaceRoot });
                console.log('Remote URL:', remoteUrl);
            } catch (error) {
                console.error('No remote origin found:', error);
                return [new GitOutgoingItem('No remote origin found', vscode.TreeItemCollapsibleState.None)];
            }

            // Get all commits since last push
            const lastPushHash = this.pushStateTracker.getLastPushHash();
            console.log('Last push hash:', lastPushHash);

            const command = lastPushHash 
                ? `git log ${lastPushHash}..${currentBranch} --oneline`
                : `git log origin/${currentBranch}..${currentBranch} --oneline`;

            console.log('Executing command:', command);
            const { stdout } = await execAsync(command, { cwd: this.workspaceRoot });
            console.log('Command output:', stdout);

            const outgoingCommits = stdout.split('\n').filter(line => line.trim());
            
            if (outgoingCommits.length === 0) {
                return [new GitOutgoingItem('No outgoing commits', vscode.TreeItemCollapsibleState.None)];
            }

            return outgoingCommits.map(commit => {
                const [hash, ...messageParts] = commit.split(' ');
                const message = messageParts.join(' ');
                
                return new GitOutgoingItem(
                    `${message} (${hash})`,
                    vscode.TreeItemCollapsibleState.None,
                    'commit',
                    undefined,
                    undefined,
                    hash
                );
            });
        } catch (error: any) {
            console.error('Error getting outgoing commits:', error);
            return [new GitOutgoingItem(`Error loading commits: ${error?.message || 'Unknown error'}`, vscode.TreeItemCollapsibleState.None)];
        }
    }

    private async getChangedFiles(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            console.log('Current branch:', currentBranch);
            
            if (!this.workspaceRoot) {
                console.log('No workspace root found');
                return [];
            }

            // Check if we're in a git repository
            try {
                await execAsync('git rev-parse --is-inside-work-tree', { cwd: this.workspaceRoot });
            } catch (error) {
                console.error('Not a git repository:', error);
                return [new GitOutgoingItem('Not a git repository', vscode.TreeItemCollapsibleState.None)];
            }

            // Check if we have a remote
            try {
                const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: this.workspaceRoot });
                console.log('Remote URL:', remoteUrl);
            } catch (error) {
                console.error('No remote origin found:', error);
                return [new GitOutgoingItem('No remote origin found', vscode.TreeItemCollapsibleState.None)];
            }

            const lastPushHash = this.pushStateTracker.getLastPushHash();
            console.log('Last push hash:', lastPushHash);

            // Get files changed only in outgoing commits (not all changes since origin)
            // First get the outgoing commits, then get files changed in those commits
            const commitsCommand = lastPushHash 
                ? `git log ${lastPushHash}..${currentBranch} --pretty=format:"%H"`
                : `git log origin/${currentBranch}..${currentBranch} --pretty=format:"%H"`;

            console.log('Getting outgoing commits:', commitsCommand);
            const { stdout: commitsOutput } = await execAsync(commitsCommand, { cwd: this.workspaceRoot });
            
            if (!commitsOutput.trim()) {
                return [new GitOutgoingItem('No outgoing commits', vscode.TreeItemCollapsibleState.None)];
            }

            const commitHashes = commitsOutput.split('\n').filter(line => line.trim());
            console.log('Found outgoing commits:', commitHashes);

            // Get all files changed in these outgoing commits
            const filesSet = new Set<string>();
            const filesStatus = new Map<string, string>();

            for (const commitHash of commitHashes) {
                const { stdout: filesOutput } = await execAsync(
                    `git show --name-status --pretty=format: ${commitHash}`,
                    { cwd: this.workspaceRoot }
                );
                
                const lines = filesOutput.split('\n').filter(line => line.trim());
                for (const line of lines) {
                    const [status, file] = line.split('\t');
                    if (file) {
                        filesSet.add(file);
                        // Keep the most recent status for each file
                        if (!filesStatus.has(file)) {
                            filesStatus.set(file, status);
                        }
                    }
                }
            }

            if (filesSet.size === 0) {
                return [new GitOutgoingItem('No changes in outgoing commits', vscode.TreeItemCollapsibleState.None)];
            }

            const files = Array.from(filesSet).map(file => ({
                file,
                status: filesStatus.get(file) || 'M'
            }));

            return files.map(({ status, file }) => {
                const statusIcon = this.getStatusIcon(status);
                return new GitOutgoingItem(
                    `${statusIcon} ${file}`,
                    vscode.TreeItemCollapsibleState.None,
                    'file',
                    file,
                    status
                );
            });
        } catch (error: any) {
            console.error('Error getting changed files:', error);
            return [new GitOutgoingItem(`Error loading files: ${error?.message || 'Unknown error'}`, vscode.TreeItemCollapsibleState.None)];
        }
    }

    private async getSyncedCommits(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            const lastPushHash = this.pushStateTracker.getLastPushHash();
            
            if (!lastPushHash) {
                return [new GitOutgoingItem('No synced commits', vscode.TreeItemCollapsibleState.None)];
            }

            // Get only commits that were in the last push
            const { stdout } = await execAsync(
                `git log ${lastPushHash}^..${lastPushHash} --oneline`,
                { cwd: this.workspaceRoot }
            );
            const commits = stdout.split('\n').filter(line => line.trim());
            
            if (commits.length === 0) {
                return [new GitOutgoingItem('No synced commits', vscode.TreeItemCollapsibleState.None)];
            }

            return commits.map(commit => {
                const [hash, ...messageParts] = commit.split(' ');
                const message = messageParts.join(' ');
                
                return new GitOutgoingItem(
                    `${message} (${hash})`,
                    vscode.TreeItemCollapsibleState.None,
                    'commit',
                    undefined,
                    undefined,
                    hash
                );
            });
        } catch (error) {
            console.error('Error getting synced commits:', error);
            return [new GitOutgoingItem('Error loading synced commits', vscode.TreeItemCollapsibleState.None)];
        }
    }

    private async getSyncedFiles(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            const lastPushHash = this.pushStateTracker.getLastPushHash();
            
            if (!lastPushHash) {
                return [new GitOutgoingItem('No synced files', vscode.TreeItemCollapsibleState.None)];
            }

            // Get files that were changed in the last push
            const { stdout } = await execAsync(
                `git diff --name-status ${lastPushHash}^..${lastPushHash}`,
                { cwd: this.workspaceRoot }
            );
            
            if (!stdout.trim()) {
                return [new GitOutgoingItem('No synced files', vscode.TreeItemCollapsibleState.None)];
            }

            const files = stdout.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [status, file] = line.split('\t');
                    return { status, file };
                });

            return files.map(({ status, file }) => {
                const statusIcon = this.getStatusIcon(status);
                return new GitOutgoingItem(
                    `${statusIcon} ${file}`,
                    vscode.TreeItemCollapsibleState.None,
                    'file',
                    file,
                    status
                );
            });
        } catch (error) {
            console.error('Error getting synced files:', error);
            return [new GitOutgoingItem('Error loading synced files', vscode.TreeItemCollapsibleState.None)];
        }
    }

    async getCurrentBranch(): Promise<string> {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspaceRoot });
        return stdout.trim();
    }

    getStatusIcon(status: string): string {
        switch (status) {
            case 'M': return '📝';
            case 'A': return '➕';
            case 'D': return '❌';
            case 'R': return '🔄';
            case 'C': return '📋';
            case 'U': return '⚠️';
            case 'T': return '📋';
            default: return '��';
        }
    }

    // Add public method to handle push updates
    async updateLastPush(): Promise<void> {
        if (this.workspaceRoot) {
            await this.pushStateTracker.updateLastPushHash(this.workspaceRoot);
            this.refresh();
        }
    }
}

class GitContentProvider implements vscode.TextDocumentContentProvider {
    constructor(private workspaceRoot: string | undefined) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        console.log('Providing content for URI:', uri.toString());
        
        if (!this.workspaceRoot) {
            return 'No workspace root available';
        }
        
        const query = new URLSearchParams(uri.query);
        const ref = query.get('ref');
        const filePath = uri.path;
        const isNewFile = query.get('new') === 'true';
        
        if (isNewFile) {
            try {
                // For new files, read from working directory
                const fullPath = path.join(this.workspaceRoot, filePath);
                const content = await fs.promises.readFile(fullPath, 'utf8');
                return content;
            } catch (error) {
                console.error('Error reading new file:', error);
                return `Error reading file: ${error}`;
            }
        }
        
        if (!ref) {
            throw new Error('No git reference provided');
        }
        
        try {
            // First check if the ref exists
            await execAsync(`git rev-parse --verify ${ref}`, { cwd: this.workspaceRoot });
            
            // Try to get the file content
            const { stdout } = await execAsync(`git show ${ref}:"${filePath}"`, { cwd: this.workspaceRoot });
            return stdout;
        } catch (error: any) {
            console.error('Error getting git content:', error);
            
            // Handle specific git errors
            if (error.message && error.message.includes('does not exist')) {
                return `File "${filePath}" does not exist at commit ${ref}`;
            } else if (error.message && error.message.includes('bad revision')) {
                return `Invalid git reference: ${ref}`;
            } else if (error.message && error.message.includes('Path')) {
                return `File "${filePath}" not found at commit ${ref}`;
            }
            
            return `Error loading file content from git: ${error.message || error}`;
        }
    }
}

class EmptyContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
        return '';
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Git Helper extension is now active');
    
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    console.log('Workspace root:', workspaceRoot);
    
    const gitOutgoingProvider = new GitOutgoingProvider(workspaceRoot);

    const treeView = vscode.window.createTreeView('gitOutgoingView', {
        treeDataProvider: gitOutgoingProvider,
        showCollapseAll: true
    });

    // Register EmptyContentProvider for empty diffs
    const emptyContentProvider = new EmptyContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('empty-diff', emptyContentProvider)
    );

    // Handle tree item selection
    context.subscriptions.push(
        treeView.onDidChangeSelection(async (e) => {
            if (e.selection.length > 0) {
                const item = e.selection[0];
                console.log('Tree item selected:', item);
                
                if (item.itemType === 'file' && item.file && item.status) {
                    // Handle file selection
                    await showFileDiff(item.file, item.status, workspaceRoot, gitOutgoingProvider);
                } else if (item.itemType === 'commit' && item.hash) {
                    // Handle commit selection
                    await showCommitDiff(item.hash, workspaceRoot, gitOutgoingProvider);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitOutgoingView.refresh', () => {
            console.log('Refresh command triggered');
            gitOutgoingProvider.refresh();
        })
    );

    // Add a test command to verify command registration
    context.subscriptions.push(
        vscode.commands.registerCommand('gitOutgoingView.test', () => {
            console.log('Test command executed');
            vscode.window.showInformationMessage('Test command works!');
        })
    );

    // Refresh when active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            console.log('Active editor changed');
            gitOutgoingProvider.refresh();
        })
    );

    // Refresh when git repository changes
    const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/**');
    context.subscriptions.push(
        gitWatcher.onDidChange(() => {
            console.log('Git repository changed');
            // Check if this was a push by looking at the reflog
            if (workspaceRoot) {
                execAsync('git reflog -1', { cwd: workspaceRoot })
                    .then(({ stdout }) => {
                        if (stdout.includes('push')) {
                            console.log('Detected git push, updating last push hash');
                            vscode.commands.executeCommand('gitOutgoingView.updateLastPush');
                        } else {
                            gitOutgoingProvider.refresh();
                        }
                    })
                    .catch(error => {
                        console.error('Error checking git reflog:', error);
                        gitOutgoingProvider.refresh();
                    });
            } else {
                gitOutgoingProvider.refresh();
            }
        }),
        gitWatcher.onDidCreate(() => {
            console.log('Git repository created');
            gitOutgoingProvider.refresh();
        }),
        gitWatcher.onDidDelete(() => {
            console.log('Git repository deleted');
            gitOutgoingProvider.refresh();
        })
    );

    // Update the command to use the new public method
    context.subscriptions.push(
        vscode.commands.registerCommand('gitOutgoingView.updateLastPush', async () => {
            await gitOutgoingProvider.updateLastPush();
        })
    );

    // Register Git content provider
    const gitContentProvider = new GitContentProvider(workspaceRoot);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('git-base', gitContentProvider)
    );
}

export function deactivate() {
    console.log('Git Helper extension is now deactivated');
}

// Helper functions
async function showFileDiff(file: string, status: string, workspaceRoot: string | undefined, gitOutgoingProvider: GitOutgoingProvider) {
    console.log('Showing file diff:', file, status);
    
    try {
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace root found');
            return;
        }

        // Get current branch
        const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot });
        const branch = currentBranch.trim();
        console.log('Current branch:', branch);

        // Get the base commit for comparison (either last push or origin)
        let baseCommit = '';
        try {
            // Try to get the merge base with origin
            const { stdout: mergeBase } = await execAsync(`git merge-base origin/${branch} ${branch}`, { cwd: workspaceRoot });
            baseCommit = mergeBase.trim();
            console.log('Base commit:', baseCommit);
        } catch (error) {
            console.error('Error getting merge base:', error);
            vscode.window.showErrorMessage('Error determining base commit for diff');
            return;
        }

        // Create URIs for the diff
        const emptyUri = vscode.Uri.parse('empty-diff:empty');
        const baseFileUri = vscode.Uri.parse(`git-base:${file}?ref=${baseCommit}`);
        const currentFileUri = vscode.Uri.file(path.join(workspaceRoot, file));
        
        // Handle different file statuses
        if (status === 'D') {
            // Deleted file - show base vs empty
            console.log('Showing deleted file diff');
            await vscode.commands.executeCommand('vscode.diff', 
                baseFileUri, 
                emptyUri, 
                `${file} (Deleted in outgoing commits)`
            );
        } else if (status === 'A') {
            // Added file - show empty vs current
            console.log('Handling added file:', file);
            
            // For new files, use direct file URI and empty-diff URI
            console.log('Using file URI:', currentFileUri.toString());
            
            try {
                // First check if file exists
                await fs.promises.access(path.join(workspaceRoot, file));
                
                // Show diff with empty file
                await vscode.commands.executeCommand('vscode.diff', 
                    emptyUri, 
                    currentFileUri, 
                    `${file} (Added in outgoing commits)`
                );
            } catch (error) {
                console.error('Error accessing file:', error);
                vscode.window.showErrorMessage(`Failed to show file diff: ${error}`);
            }
        } else {
            // Modified file - show base vs current
            console.log('Showing modified file diff');
            
            // Check if file exists in working directory
            try {
                await fs.promises.access(path.join(workspaceRoot, file));
                await vscode.commands.executeCommand('vscode.diff', 
                    baseFileUri, 
                    currentFileUri, 
                    `${file} (Modified in outgoing commits)`
                );
            } catch (accessError) {
                // File doesn't exist in working directory, compare with HEAD
                const headFileUri = vscode.Uri.parse(`git-base:${file}?ref=HEAD`);
                await vscode.commands.executeCommand('vscode.diff', 
                    baseFileUri, 
                    headFileUri, 
                    `${file} (Modified in outgoing commits)`
                );
            }
        }

    } catch (error) {
        console.error(`Error showing file ${file}:`, error);
        vscode.window.showErrorMessage(`Failed to show file diff ${file}: ${error}`);
    }
}

async function showCommitDiff(hash: string, workspaceRoot: string | undefined, gitOutgoingProvider: GitOutgoingProvider) {
    console.log('Showing commit diff:', hash);
    
    try {
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace root found');
            return;
        }

        // Get commit info
        const { stdout: commitInfo } = await execAsync(
            `git show --pretty=format:"%h %an %ad %s" --date=short ${hash}`,
            { cwd: workspaceRoot }
        );
        
        const commitHeader = commitInfo.split('\n')[0];

        // Get the diff with context
        const { stdout: diffOutput } = await execAsync(
            `git show --color=never --unified=3 ${hash}`,
            { cwd: workspaceRoot }
        );

        console.log('Got diff output, creating webview');
        
        // Create and show webview panel
        const panel = vscode.window.createWebviewPanel(
            'gitCommitDiff',
            `Commit ${hash.substring(0, 7)}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = createDiffHtml(diffOutput, commitHeader, hash);

    } catch (error) {
        console.error('Error showing commit diff:', error);
        vscode.window.showErrorMessage(`Failed to show commit diff: ${error}`);
    }
}

function createDiffHtml(diffOutput: string, commitHeader: string, hash: string): string {
    // Parse and format the diff
    const lines = diffOutput.split('\n');
    let formattedDiff = '';
    let currentFile = '';
    
    for (const line of lines) {
        if (line.startsWith('commit ') || line.startsWith('Author: ') || line.startsWith('Date: ')) {
            // Skip git show header lines
            continue;
        }
        
        if (line.startsWith('diff --git')) {
            const match = line.match(/diff --git a\/(.*) b\/(.*)/);
            if (match) {
                currentFile = match[1];
                formattedDiff += `<div class="file-header">📄 ${currentFile}</div>\n`;
            }
            continue;
        }
        
        if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
            // Skip git metadata lines
            continue;
        }
        
        if (line.startsWith('@@')) {
            // Hunk header
            formattedDiff += `<div class="hunk-header">🔍 ${line}</div>\n`;
            continue;
        }
        
        // Format diff lines
        let cssClass = 'context';
        let icon = '';
        
        if (line.startsWith('+')) {
            cssClass = 'addition';
            icon = '➕ ';
        } else if (line.startsWith('-')) {
            cssClass = 'deletion';
            icon = '➖ ';
        } else if (line.startsWith(' ')) {
            cssClass = 'context';
            icon = '   ';
        }
        
        const escapedLine = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        formattedDiff += `<div class="diff-line ${cssClass}">${icon}${escapedLine}</div>\n`;
    }

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Commit Diff</title>
            <style>
                body {
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 13px;
                    line-height: 1.4;
                    margin: 0;
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                
                .commit-header {
                    background-color: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    padding: 15px;
                    margin-bottom: 20px;
                    border-radius: 4px;
                    font-weight: bold;
                }
                
                .file-header {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 8px 12px;
                    margin: 15px 0 5px 0;
                    border-radius: 4px;
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                    border-left: 3px solid var(--vscode-textLink-foreground);
                }
                
                .hunk-header {
                    background-color: var(--vscode-diffEditor-unchangedCodeBackground);
                    color: var(--vscode-diffEditor-unchangedTextForeground);
                    padding: 4px 8px;
                    margin: 8px 0 2px 0;
                    border-radius: 3px;
                    font-weight: bold;
                    font-size: 11px;
                }
                
                .diff-line {
                    padding: 1px 8px;
                    white-space: pre;
                    word-wrap: break-word;
                    border-left: 3px solid transparent;
                }
                
                .diff-line.addition {
                    background-color: var(--vscode-diffEditor-insertedTextBackground);
                    color: var(--vscode-diffEditor-insertedTextForeground);
                    border-left-color: #28a745;
                }
                
                .diff-line.deletion {
                    background-color: var(--vscode-diffEditor-removedTextBackground);
                    color: var(--vscode-diffEditor-removedTextForeground);
                    border-left-color: #dc3545;
                }
                
                .diff-line.context {
                    background-color: transparent;
                    color: var(--vscode-editor-foreground);
                }
                
                .diff-container {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    overflow: hidden;
                }
            </style>
        </head>
        <body>
            <div class="commit-header">
                🔄 ${commitHeader}
            </div>
            
            <div class="diff-container">
                ${formattedDiff}
            </div>
        </body>
        </html>
    `;
} 