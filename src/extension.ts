import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class GitOutgoingItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
    }
}

class PushStateTracker {
    private lastPushHash: string | null = null;

    async updateLastPushHash(workspaceRoot: string): Promise<void> {
        try {
            const { stdout } = await execAsync('git rev-parse origin/HEAD', { cwd: workspaceRoot });
            this.lastPushHash = stdout.trim();
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
                return [];
            }

            // Get all commits since last push
            const lastPushHash = this.pushStateTracker.getLastPushHash();
            const command = lastPushHash 
                ? `git log ${lastPushHash}..${currentBranch} --oneline`
                : `git log origin/${currentBranch}..${currentBranch} --oneline`;

            const { stdout } = await execAsync(command, { cwd: this.workspaceRoot });
            const outgoingCommits = stdout.split('\n').filter(line => line.trim());
            
            return outgoingCommits.map(commit => {
                const [hash, ...messageParts] = commit.split(' ');
                const message = messageParts.join(' ');
                
                return new GitOutgoingItem(
                    `${message} (${hash})`,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'gitOutgoingView.showCommitDiff',
                        title: 'Show Commit Diff',
                        arguments: [hash]
                    }
                );
            });
        } catch (error) {
            console.error('Error getting outgoing commits:', error);
            return [new GitOutgoingItem('Error loading commits', vscode.TreeItemCollapsibleState.None)];
        }
    }

    private async getChangedFiles(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            // Get all files changed in outgoing commits
            const { stdout } = await execAsync(`git diff --name-status origin/${currentBranch}..${currentBranch}`, { cwd: this.workspaceRoot });
            console.log('Git diff output:', stdout);
            
            if (!stdout.trim()) {
                return [new GitOutgoingItem('No changes in outgoing commits', vscode.TreeItemCollapsibleState.None)];
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
                    {
                        command: 'gitOutgoingView.showFileDiff',
                        title: 'Show File Diff',
                        arguments: [file, status]
                    }
                );
            });
        } catch (error) {
            console.error('Error getting changed files:', error);
            return [new GitOutgoingItem('Error loading files', vscode.TreeItemCollapsibleState.None)];
        }
    }

    private async getSyncedCommits(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            const lastPushHash = this.pushStateTracker.getLastPushHash();
            
            if (!lastPushHash) {
                return [new GitOutgoingItem('No synced commits', vscode.TreeItemCollapsibleState.None)];
            }

            // Get commits that are in both local and remote up to last push
            const { stdout } = await execAsync(`git log ${lastPushHash} --oneline`, { cwd: this.workspaceRoot });
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
                    {
                        command: 'gitOutgoingView.showCommitDiff',
                        title: 'Show Commit Diff',
                        arguments: [hash]
                    }
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
            // Get all files that are synced with remote
            const { stdout } = await execAsync(`git ls-tree -r --name-only origin/${currentBranch}`, { cwd: this.workspaceRoot });
            
            if (!stdout.trim()) {
                return [new GitOutgoingItem('No synced files', vscode.TreeItemCollapsibleState.None)];
            }

            const files = stdout.split('\n').filter(line => line.trim());

            return files.map(file => {
                return new GitOutgoingItem(
                    `📄 ${file}`,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'gitOutgoingView.showFileDiff',
                        title: 'Show File Diff',
                        arguments: [file, 'M']
                    }
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

export function activate(context: vscode.ExtensionContext) {
    console.log('Git Helper extension is now active');
    
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    console.log('Workspace root:', workspaceRoot);
    
    const gitOutgoingProvider = new GitOutgoingProvider(workspaceRoot);

    const treeView = vscode.window.createTreeView('gitOutgoingView', {
        treeDataProvider: gitOutgoingProvider
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('gitOutgoingView.refresh', () => {
            console.log('Refresh command triggered');
            gitOutgoingProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitOutgoingView.showCommitDiff', async (hash: string) => {
            console.log('Showing commit diff:', hash);
            try {
                if (!workspaceRoot) {
                    vscode.window.showErrorMessage('No workspace root found');
                    return;
                }

                // Get the commit message
                const { stdout: commitMessage } = await execAsync(`git log -1 --pretty=format:%s ${hash}`, { cwd: workspaceRoot });
                
                // Get the list of changed files in this specific commit
                const { stdout: changedFiles } = await execAsync(`git show --name-status --pretty=format: ${hash}`, { cwd: workspaceRoot });
                const files = changedFiles.split('\n')
                    .filter(line => line.trim())
                    .map(line => {
                        const [status, file] = line.split('\t');
                        return { status, file };
                    })
                    .filter(({ file }) => file);

                if (files.length === 0) {
                    vscode.window.showInformationMessage('No files changed in this commit');
                    return;
                }

                const fileItems = files.map(({ status, file }) => ({
                    label: `${gitOutgoingProvider.getStatusIcon(status)} ${file}`,
                    description: status,
                    file: file,
                    status: status
                }));

                const selectedFile = await vscode.window.showQuickPick(fileItems, {
                    placeHolder: `Select a file to view changes (${hash})`,
                    matchOnDescription: true
                });

                if (!selectedFile) {
                    return;
                }

                // Create temporary files for the diff
                const tempDir = vscode.Uri.file(workspaceRoot).with({ scheme: 'git-outgoing' });
                const leftUri = tempDir.with({ path: `/${hash}^/${selectedFile.file}` });
                const rightUri = tempDir.with({ path: `/${hash}/${selectedFile.file}` });

                // Get the file content before and after the commit
                const { stdout: leftContent } = await execAsync(
                    `git show ${hash}^:${selectedFile.file}`,
                    { cwd: workspaceRoot }
                );
                const { stdout: rightContent } = await execAsync(
                    `git show ${hash}:${selectedFile.file}`,
                    { cwd: workspaceRoot }
                );

                // Set content in the content provider
                contentProvider.setContent(leftUri, leftContent);
                contentProvider.setContent(rightUri, rightContent);

                // Create a diff editor
                const diffEditor = await vscode.workspace.openTextDocument(leftUri);
                const rightDoc = await vscode.workspace.openTextDocument(rightUri);
                
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${selectedFile.file} (${hash})`);

            } catch (error) {
                console.error('Error showing commit diff:', error);
                vscode.window.showErrorMessage(`Failed to show commit diff: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitOutgoingView.showFileDiff', async (file: string, status: string) => {
            try {
                if (!workspaceRoot) {
                    vscode.window.showErrorMessage('No workspace root found');
                    return;
                }

                const currentBranch = await gitOutgoingProvider.getCurrentBranch();
                
                // Create temporary files for the diff
                const tempDir = vscode.Uri.file(workspaceRoot).with({ scheme: 'git-outgoing' });
                const leftUri = tempDir.with({ path: `/origin/${currentBranch}/${file}` });
                const rightUri = tempDir.with({ path: `/${currentBranch}/${file}` });

                // Get the file content from origin and current branch
                const { stdout: leftContent } = await execAsync(
                    `git show origin/${currentBranch}:${file}`,
                    { cwd: workspaceRoot }
                );
                const { stdout: rightContent } = await execAsync(
                    `git show ${currentBranch}:${file}`,
                    { cwd: workspaceRoot }
                );

                // Set content in the content provider
                contentProvider.setContent(leftUri, leftContent);
                contentProvider.setContent(rightUri, rightContent);

                // Create a diff editor
                const diffEditor = await vscode.workspace.openTextDocument(leftUri);
                const rightDoc = await vscode.workspace.openTextDocument(rightUri);
                
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${file} (${currentBranch})`);

            } catch (error) {
                console.error(`Error showing diff for file ${file}:`, error);
                vscode.window.showErrorMessage(`Failed to show diff for ${file}: ${error}`);
            }
        })
    );

    // Register content provider for temporary files
    const contentProvider = new class implements vscode.TextDocumentContentProvider {
        private contentMap = new Map<string, string>();

        async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
            const content = this.contentMap.get(uri.toString());
            return content || '';
        }

        setContent(uri: vscode.Uri, content: string) {
            this.contentMap.set(uri.toString(), content);
        }

        clearContent(uri: vscode.Uri) {
            this.contentMap.delete(uri.toString());
        }
    };

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('git-outgoing', contentProvider)
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
}

export function deactivate() {
    console.log('Git Helper extension is now deactivated');
} 