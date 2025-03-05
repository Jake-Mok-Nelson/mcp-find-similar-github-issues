import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "support-assistant/1.0";
// GitHub Personal Access Token should be set in environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Create server instance
const server = new McpServer({
    name: "support-assistant",
    version: "1.0.0",
});
// Helper function for making GitHub API requests
async function makeGithubRequest(path, params = {}) {
    const url = new URL(path, GITHUB_API_BASE);
    // Add query parameters
    Object.entries(params).forEach(([key, value]) => {
        if (value)
            url.searchParams.append(key, value);
    });
    const headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    };
    // Add authorization if token is available
    if (GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
    }
    try {
        const response = await fetch(url.toString(), { headers });
        if (!response.ok) {
            throw new Error(`GitHub API error! status: ${response.status}`);
        }
        return (await response.json());
    }
    catch (error) {
        console.error("Error making GitHub request:", error);
        return null;
    }
}
// Calculate similarity score between two texts (simple implementation)
function calculateSimilarity(text1, text2) {
    // Convert to lowercase and remove special characters for comparison
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '');
    const words1 = new Set(normalize(text1).split(/\s+/));
    const words2 = new Set(normalize(text2).split(/\s+/));
    // Find intersection of words
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    // Calculate Jaccard similarity coefficient
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
}
// Format issue data for display
function formatIssue(issue, similarityScore) {
    const labels = issue.labels.map(label => label.name).join(", ");
    const status = issue.state === "closed" ? "Closed" : "Open";
    const closedDate = issue.closed_at ? new Date(issue.closed_at).toLocaleDateString() : "N/A";
    return [
        `Issue #${issue.number}: ${issue.title}`,
        `URL: ${issue.html_url}`,
        `Status: ${status}${issue.closed_at ? ` (closed on ${closedDate})` : ''}`,
        `Labels: ${labels || "None"}`,
        `Similarity: ${(similarityScore * 100).toFixed(1)}%`,
        "---",
    ].join("\n");
}
// Register support tools
server.tool("find-similar-issues", "Find GitHub issues similar to a new issue description", {
    owner: z.string().describe("GitHub repository owner/organization"),
    repo: z.string().describe("GitHub repository name"),
    issueDescription: z.string().describe("Description of the issue to find similar ones for"),
    maxResults: z.number().int().min(1).max(20).default(5).describe("Maximum number of similar issues to return")
}, async ({ owner, repo, issueDescription, maxResults }) => {
    // Combine title and description for better search results
    const searchText = `${issueDescription}`;
    // Extract important keywords for search (simple approach)
    const keywords = searchText
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 3) // Filter out short words
        .filter(word => !['the', 'and', 'that', 'this', 'with'].includes(word)) // Filter common words
        .slice(0, 10) // Limit number of keywords
        .join(' ');
    // Search for issues in the repository
    const searchParams = {
        q: `repo:${owner}/${repo} ${keywords}`,
        sort: 'updated',
        order: 'desc',
        per_page: '30' // Get more results to filter by similarity
    };
    const searchResponse = await makeGithubRequest('/search/issues', searchParams);
    if (!searchResponse) {
        return {
            content: [
                {
                    type: "text",
                    text: "Failed to retrieve issues from GitHub"
                }
            ]
        };
    }
    if (searchResponse.total_count === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `No similar issues found in ${owner}/${repo}`
                }
            ]
        };
    }
    // Calculate similarity score for each issue
    const issuesWithScores = searchResponse.items
        .map(issue => ({
        issue,
        score: calculateSimilarity(searchText, `${issue.title} ${issue.body || ''}`)
    }))
        .sort((a, b) => b.score - a.score) // Sort by similarity score (highest first)
        .slice(0, maxResults); // Take top N results
    // Format the response
    const formattedIssues = issuesWithScores.map(({ issue, score }) => formatIssue(issue, score));
    const responseText = `Found ${issuesWithScores.length} similar issues in ${owner}/${repo}:\n\n${formattedIssues.join("\n")}`;
    return {
        content: [
            {
                type: "text",
                text: responseText
            }
        ]
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Support Assistant MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
