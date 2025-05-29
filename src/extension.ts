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

class GitOutgoingProvider implements vscode.TreeDataProvider<GitOutgoingItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GitOutgoingItem | undefined | null | void> = new vscode.EventEmitter<GitOutgoingItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GitOutgoingItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string | undefined) {
        console.log('GitOutgoingProvider initialized with workspace:', workspaceRoot);
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
                new GitOutgoingItem('📄 Changed Files', vscode.TreeItemCollapsibleState.Expanded)
            ];
        }

        if (element.label === '📦 Outgoing Commits') {
            console.log('Getting outgoing commits');
            return this.getOutgoingCommits();
        } else if (element.label === '📄 Changed Files') {
            console.log('Getting changed files');
            return this.getChangedFiles();
        }

        return [];
    }

    private async getOutgoingCommits(): Promise<GitOutgoingItem[]> {
        try {
            const currentBranch = await this.getCurrentBranch();
            console.log('Current branch:', currentBranch);
            const outgoingCommits = await this.getGitOutgoingCommits(currentBranch);
            console.log('Outgoing commits:', outgoingCommits);
            
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
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [vscode.Uri.file(`${this.workspaceRoot}/${file}`)]
                    }
                );
            });
        } catch (error) {
            console.error('Error getting changed files:', error);
            return [new GitOutgoingItem('Error loading files', vscode.TreeItemCollapsibleState.None)];
        }
    }

    private async getCurrentBranch(): Promise<string> {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspaceRoot });
        return stdout.trim();
    }

    private async getGitOutgoingCommits(branch: string): Promise<string[]> {
        const { stdout } = await execAsync(`git log origin/${branch}..${branch} --oneline`, { cwd: this.workspaceRoot });
        return stdout.split('\n').filter(line => line.trim());
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
            default: return '📄';
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
                    .filter(({ file }) => file); // Filter out empty lines

                if (files.length === 0) {
                    vscode.window.showInformationMessage('No files changed in this commit');
                    return;
                }

                // Create a diff editor for each file
                for (const { status, file } of files) {
                    try {
                        // Get the file content before the commit
                        const { stdout: oldContent } = await execAsync(`git show ${hash}^:${file}`, { cwd: workspaceRoot });
                        
                        // Get the file content at the commit
                        const { stdout: newContent } = await execAsync(`git show ${hash}:${file}`, { cwd: workspaceRoot });

                        // Create temporary files for the diff
                        const oldUri = vscode.Uri.parse(`git-outgoing://${hash}^/${file}`);
                        const newUri = vscode.Uri.parse(`git-outgoing://${hash}/${file}`);

                        // Register content provider for the temporary files
                        const contentProvider = new class implements vscode.TextDocumentContentProvider {
                            async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
                                return uri.toString().includes(`${hash}^`) ? oldContent : newContent;
                            }
                        };

                        context.subscriptions.push(
                            vscode.workspace.registerTextDocumentContentProvider('git-outgoing', contentProvider)
                        );

                        // Get status icon for the file
                        const statusIcon = gitOutgoingProvider.getStatusIcon(status);

                        // Open the diff editor
                        await vscode.commands.executeCommand('vscode.diff',
                            oldUri,
                            newUri,
                            `${statusIcon} ${file} (${hash}) - ${commitMessage}`,
                            { preview: true }
                        );
                    } catch (error) {
                        console.error(`Error showing diff for file ${file}:`, error);
                        // Continue with next file even if one fails
                        continue;
                    }
                }
            } catch (error) {
                console.error('Error showing commit diff:', error);
                vscode.window.showErrorMessage(`Failed to show commit diff: ${error}`);
            }
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
            gitOutgoingProvider.refresh();
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
}

export function deactivate() {
    console.log('Git Helper extension is now deactivated');
} 