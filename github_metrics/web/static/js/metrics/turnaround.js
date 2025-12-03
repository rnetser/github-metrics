/**
 * Turnaround Metrics Module
 *
 * Handles loading and displaying review turnaround metrics on the Contributors page.
 *
 * Features:
 * - Loads data when Contributors page is shown
 * - Displays KPI cards with summary metrics
 * - Populates repository and reviewer tables
 * - Handles loading/error states
 * - Supports table sorting
 */

import { apiClient } from './api-client.js';

class TurnaroundMetrics {
    constructor() {
        console.log('[Turnaround] Constructor called');
        this.data = null;
        this.loadingElement = document.getElementById('turnaround-loading');
        this.errorElement = document.getElementById('turnaround-error');
        this.contentElement = document.getElementById('turnaround-content');

        // KPI elements
        this.kpiFirstReview = document.getElementById('kpi-first-review');
        this.kpiApproval = document.getElementById('kpi-approval');
        this.kpiLifecycle = document.getElementById('kpi-lifecycle');
        this.kpiTotalPrs = document.getElementById('kpi-total-prs');

        // Table bodies
        this.repoTableBody = document.getElementById('turnaround-by-repo-body');
        this.reviewerTableBody = document.getElementById('turnaround-by-reviewer-body');

        // Contributor metrics table bodies
        this.prCreatorsTableBody = document.getElementById('pr-creators-metrics-body');
        this.prReviewersTableBody = document.getElementById('pr-reviewers-metrics-body');
        this.prApproversTableBody = document.getElementById('pr-approvers-metrics-body');
        this.prLgtmTableBody = document.getElementById('pr-lgtm-metrics-body');

        // Contributor metrics data and pagination state
        this.contributorMetrics = {
            pr_creators: { data: [], pagination: null, currentPage: 1 },
            pr_reviewers: { data: [], pagination: null, currentPage: 1 },
            pr_approvers: { data: [], pagination: null, currentPage: 1 },
            pr_lgtm: { data: [], pagination: null, currentPage: 1 }
        };

        // Filter timeouts for debouncing
        this.filterTimeouts = {
            repo: null,
            user: null
        };

        this.initialize();
    }

    /**
     * Initialize turnaround metrics
     */
    initialize() {
        console.log('[Turnaround] Initializing turnaround metrics');

        // Listen for page navigation to Contributors
        this.setupPageChangeListener();

        // Set up table sorting
        this.setupTableSorting();

        // Set up download buttons
        this.setupDownloadButtons();

        // Set up contributor metrics pagination
        this.setupContributorPagination();

        // Check if we should load metrics (handles direct navigation to #contributors)
        this.checkAndLoadMetrics();
    }

    /**
     * Check if we should load metrics and load them if conditions are met
     */
    checkAndLoadMetrics(retryCount = 0) {
        const hash = window.location.hash; // Full hash including #
        const currentHash = hash.slice(1) || 'overview'; // Remove # and default to overview

        console.log('[Turnaround] checkAndLoadMetrics - full hash:', hash, 'parsed:', currentHash);

        if (currentHash !== 'contributors') {
            console.log('[Turnaround] Not on contributors page, skipping initial load. Hash is:', currentHash);
            return;
        }

        // Check if time filters are ready
        const startTimeInput = document.getElementById('startTime');
        const endTimeInput = document.getElementById('endTime');

        console.log('[Turnaround] startTime:', startTimeInput?.value, 'endTime:', endTimeInput?.value);

        if (startTimeInput && startTimeInput.value && endTimeInput && endTimeInput.value) {
            console.log('[Turnaround] Time filters ready, loading metrics');
            this.loadMetrics();
        } else {
            console.log('[Turnaround] Time filters not ready, waiting...');
            // Retry after a short delay with max attempts
            const maxRetries = 50; // 50 retries * 100ms = 5 seconds
            if (retryCount < maxRetries) {
                setTimeout(() => this.checkAndLoadMetrics(retryCount + 1), 100);
            } else {
                console.error('[Turnaround] Max retry attempts reached. Time filters failed to initialize.');
            }
        }
    }

    /**
     * Set up listener for page changes
     */
    setupPageChangeListener() {
        // Listen for hash changes - load metrics directly when navigating to contributors
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            if (hash === 'contributors') {
                console.log('[Turnaround] Navigated to contributors page, loading metrics');
                this.loadMetrics();
            }
        });

        // Listen for time filter changes - always reload data when time changes
        // Listen for time filter updates from dashboard (custom event)
        document.addEventListener('timeFiltersUpdated', () => {
            const hash = window.location.hash.slice(1);
            if (hash === 'contributors') {
                console.log('[Turnaround] Time filters updated, refreshing metrics');
                this.loadMetrics();
            }
        });

        // Listen for repository and user filter changes with debounce
        document.addEventListener('input', (e) => {
            if (e.target.id === 'repositoryFilter') {
                clearTimeout(this.filterTimeouts.repo);
                this.filterTimeouts.repo = setTimeout(() => {
                    const hash = window.location.hash.slice(1);
                    if (hash === 'contributors') {
                        console.log('[Turnaround] Repository filter changed, refreshing metrics');
                        this.loadMetrics();
                    }
                }, 300);
            } else if (e.target.id === 'userFilter') {
                clearTimeout(this.filterTimeouts.user);
                this.filterTimeouts.user = setTimeout(() => {
                    const hash = window.location.hash.slice(1);
                    if (hash === 'contributors') {
                        console.log('[Turnaround] User filter changed, refreshing metrics');
                        this.loadMetrics();
                    }
                }, 300);
            }
        });
    }

    /**
     * Load turnaround metrics from API
     */
    async loadMetrics() {
        console.log('[Turnaround] Loading turnaround metrics');

        // Show loading state
        this.showLoading();

        try {
            // Get time filter values from the shared control panel
            const filters = this.getTimeFilters();
            console.log('[Turnaround] Using filters:', filters);

            // Fetch data from API with filters
            const response = await apiClient.fetchTurnaroundMetrics(filters);

            // Check for errors
            if (response.error) {
                this.showError(`Failed to load metrics: ${response.detail || response.error}`);
                return;
            }

            // Store data
            this.data = response;

            // Debug logging
            console.log('[Turnaround] Response received:', {
                hasSummary: !!response.summary,
                repositoryCount: response.by_repository?.length || 0,
                reviewerCount: response.by_reviewer?.length || 0
            });

            // Update UI
            this.updateKPIs(response.summary);
            this.updateRepositoryTable(response.by_repository || []);
            this.updateReviewerTable(response.by_reviewer || []);

            // Load contributor metrics (each category separately)
            await this.loadContributorMetrics();

            // Show content
            this.showContent();

        } catch (error) {
            console.error('[Turnaround] Error loading metrics:', error);
            this.showError(`Unexpected error: ${error.message}`);
        }
    }

    /**
     * Get time filter values from the shared control panel
     */
    getTimeFilters() {
        const startTimeInput = document.getElementById('startTime');
        const endTimeInput = document.getElementById('endTime');
        const repoInput = document.getElementById('repositoryFilter');
        const userInput = document.getElementById('userFilter');

        const filters = {};

        // Convert datetime-local input to ISO 8601 format
        if (startTimeInput && startTimeInput.value) {
            const startDate = new Date(startTimeInput.value);
            filters.start_time = startDate.toISOString();
        }

        if (endTimeInput && endTimeInput.value) {
            const endDate = new Date(endTimeInput.value);
            filters.end_time = endDate.toISOString();
        }

        // Add repository filter
        if (repoInput && repoInput.value) {
            filters.repository = repoInput.value;
        }

        // Add user filter
        if (userInput && userInput.value) {
            filters.user = userInput.value;
        }

        return filters;
    }

    /**
     * Update KPI cards with summary data
     */
    updateKPIs(summary) {
        if (!summary) {
            console.warn('[Turnaround] No summary data available');
            return;
        }

        // Update KPI values
        this.kpiFirstReview.textContent = this.formatHours(summary.avg_time_to_first_review_hours);
        this.kpiApproval.textContent = this.formatHours(summary.avg_time_to_approval_hours);
        this.kpiLifecycle.textContent = this.formatHours(summary.avg_pr_lifecycle_hours);
        this.kpiTotalPrs.textContent = summary.total_prs_analyzed || 0;
    }

    /**
     * Update repository table with data
     */
    updateRepositoryTable(repositories) {
        if (!this.repoTableBody) {
            console.warn('[Turnaround] Repository table body not found');
            return;
        }

        // Clear existing rows
        this.repoTableBody.innerHTML = '';

        // Handle empty data
        if (!repositories || repositories.length === 0) {
            this.repoTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">No data available</td></tr>';
            return;
        }

        // Populate table
        repositories.forEach(repo => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${this.escapeHtml(repo.repository)}</td>
                <td>${this.formatHours(repo.avg_time_to_first_review_hours)}</td>
                <td>${this.formatHours(repo.avg_time_to_approval_hours)}</td>
                <td>${this.formatHours(repo.avg_pr_lifecycle_hours)}</td>
                <td>${repo.total_prs}</td>
            `;
            this.repoTableBody.appendChild(row);
        });
    }

    /**
     * Update reviewer table with data
     */
    updateReviewerTable(reviewers) {
        if (!this.reviewerTableBody) {
            console.warn('[Turnaround] Reviewer table body not found');
            return;
        }

        // Clear existing rows
        this.reviewerTableBody.innerHTML = '';

        // Handle empty data
        if (!reviewers || reviewers.length === 0) {
            this.reviewerTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">No data available</td></tr>';
            return;
        }

        // Populate table
        reviewers.forEach(reviewer => {
            const row = document.createElement('tr');
            const repos = Array.isArray(reviewer.repositories_reviewed)
                ? reviewer.repositories_reviewed.join(', ')
                : reviewer.repositories_reviewed || '';

            row.innerHTML = `
                <td>${this.escapeHtml(reviewer.reviewer)}</td>
                <td>${this.formatHours(reviewer.avg_response_time_hours)}</td>
                <td>${reviewer.total_reviews}</td>
                <td title="${this.escapeHtml(repos)}">${this.truncateText(repos, 50)}</td>
            `;
            this.reviewerTableBody.appendChild(row);
        });
    }

    /**
     * Format hours for display in human-readable format
     */
    formatHours(hours) {
        if (hours === null || hours === undefined) {
            return 'N/A';
        }

        const num = parseFloat(hours);
        if (isNaN(num)) {
            return 'N/A';
        }

        // Less than 1 hour: show minutes
        if (num < 1) {
            const minutes = Math.round(num * 60);
            return `${minutes}m`;
        }

        // 1-24 hours: show hours
        if (num < 24) {
            return `${num.toFixed(1)}h`;
        }

        // 24-168 hours (1 week): show days and hours
        if (num < 168) {
            const days = Math.floor(num / 24);
            const remainingHours = Math.round(num % 24);
            return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
        }

        // 168+ hours: show weeks and days
        const weeks = Math.floor(num / 168);
        const remainingDays = Math.floor((num % 168) / 24);
        return remainingDays > 0 ? `${weeks}w ${remainingDays}d` : `${weeks}w`;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Truncate text with ellipsis
     */
    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return this.escapeHtml(text);
        return this.escapeHtml(text.substring(0, maxLength) + '...');
    }

    /**
     * Show loading state
     */
    showLoading() {
        if (this.loadingElement) this.loadingElement.style.display = 'flex';
        if (this.errorElement) this.errorElement.style.display = 'none';
        if (this.contentElement) this.contentElement.style.display = 'none';
    }

    /**
     * Show error state
     */
    showError(message) {
        if (this.errorElement) {
            const errorMessage = this.errorElement.querySelector('.error-message');
            if (errorMessage) {
                errorMessage.textContent = message;
            }
            this.errorElement.style.display = 'block';
        }
        if (this.loadingElement) this.loadingElement.style.display = 'none';
        if (this.contentElement) this.contentElement.style.display = 'none';
    }

    /**
     * Show content
     */
    showContent() {
        if (this.contentElement) this.contentElement.style.display = 'block';
        if (this.loadingElement) this.loadingElement.style.display = 'none';
        if (this.errorElement) this.errorElement.style.display = 'none';
    }

    /**
     * Set up table sorting
     */
    setupTableSorting() {
        // Repository table
        const repoTable = document.getElementById('turnaroundByRepoTable');
        if (repoTable) {
            this.setupTableSortingForTable(repoTable, 'by_repository');
        }

        // Reviewer table
        const reviewerTable = document.getElementById('turnaroundByReviewerTable');
        if (reviewerTable) {
            this.setupTableSortingForTable(reviewerTable, 'by_reviewer');
        }

        // Contributor metrics tables
        const prCreatorsTable = document.getElementById('prCreatorsMetricsTable');
        if (prCreatorsTable) {
            this.setupContributorTableSorting(prCreatorsTable, 'pr_creators');
        }

        const prReviewersTable = document.getElementById('prReviewersMetricsTable');
        if (prReviewersTable) {
            this.setupContributorTableSorting(prReviewersTable, 'pr_reviewers');
        }

        const prApproversTable = document.getElementById('prApproversMetricsTable');
        if (prApproversTable) {
            this.setupContributorTableSorting(prApproversTable, 'pr_approvers');
        }

        const prLgtmTable = document.getElementById('prLgtmMetricsTable');
        if (prLgtmTable) {
            this.setupContributorTableSorting(prLgtmTable, 'pr_lgtm');
        }
    }

    /**
     * Set up sorting for a specific table
     */
    setupTableSortingForTable(table, dataKey) {
        const headers = table.querySelectorAll('th.sortable');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.column;
                this.sortTable(table, dataKey, column);
            });
        });
    }

    /**
     * Sort table by column
     */
    sortTable(table, dataKey, column) {
        if (!this.data || !this.data[dataKey]) {
            return;
        }

        const headers = table.querySelectorAll('th.sortable');
        const clickedHeader = Array.from(headers).find(h => h.dataset.column === column);

        // Determine sort direction
        let direction = 'asc';
        if (clickedHeader.classList.contains('sort-asc')) {
            direction = 'desc';
        } else if (clickedHeader.classList.contains('sort-desc')) {
            direction = 'asc';
        }

        // Clear all sort indicators
        headers.forEach(h => {
            h.classList.remove('sort-asc', 'sort-desc');
        });

        // Set new sort indicator
        clickedHeader.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

        // Sort data
        const sortedData = [...this.data[dataKey]].sort((a, b) => {
            const aVal = a[column];
            const bVal = b[column];

            // Handle null/undefined
            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;

            // Compare values
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            } else {
                const aStr = String(aVal).toLowerCase();
                const bStr = String(bVal).toLowerCase();
                return direction === 'asc'
                    ? aStr.localeCompare(bStr)
                    : bStr.localeCompare(aStr);
            }
        });

        // Update table
        if (dataKey === 'by_repository') {
            this.updateRepositoryTable(sortedData);
        } else if (dataKey === 'by_reviewer') {
            this.updateReviewerTable(sortedData);
        }
    }

    /**
     * Set up download buttons
     */
    setupDownloadButtons() {
        // Repository download buttons
        const repoButtons = document.querySelectorAll('[data-section="turnaroundByRepo"]');
        repoButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const format = e.currentTarget.dataset.format;
                this.downloadData('by_repository', 'turnaround_by_repository', format);
            });
        });

        // Reviewer download buttons
        const reviewerButtons = document.querySelectorAll('[data-section="turnaroundByReviewer"]');
        reviewerButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const format = e.currentTarget.dataset.format;
                this.downloadData('by_reviewer', 'turnaround_by_reviewer', format);
            });
        });

        // Contributor metrics download buttons
        const contributorSections = {
            prCreatorsMetrics: 'pr_creators',
            prReviewersMetrics: 'pr_reviewers',
            prApproversMetrics: 'pr_approvers',
            prLgtmMetrics: 'pr_lgtm'
        };

        Object.entries(contributorSections).forEach(([section, category]) => {
            const buttons = document.querySelectorAll(`[data-section="${section}"]`);
            buttons.forEach(button => {
                button.addEventListener('click', (e) => {
                    const format = e.currentTarget.dataset.format;
                    this.downloadContributorData(category, section, format);
                });
            });
        });
    }

    /**
     * Download data as CSV or JSON
     */
    downloadData(dataKey, filename, format) {
        if (!this.data || !this.data[dataKey]) {
            console.warn('[Turnaround] No data available for download');
            return;
        }

        const data = this.data[dataKey];

        if (format === 'csv') {
            this.downloadCSV(data, filename);
        } else if (format === 'json') {
            this.downloadJSON(data, filename);
        }
    }

    /**
     * Sanitize CSV values to prevent formula injection
     */
    sanitizeCSVValue(value) {
        const str = String(value || '');
        const escaped = str.replace(/"/g, '""');
        // Prefix dangerous characters with single quote
        if (/^[=+\-@]/.test(escaped)) {
            return "'" + escaped;
        }
        return escaped;
    }

    /**
     * Download data as CSV
     */
    downloadCSV(data, filename) {
        if (!data || data.length === 0) {
            console.warn('[Turnaround] No data to download');
            return;
        }

        // Get headers from first object
        const headers = Object.keys(data[0]);
        const csvRows = [];

        // Add header row
        csvRows.push(headers.join(','));

        // Add data rows
        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                // Handle arrays (e.g., repositories_reviewed)
                if (Array.isArray(value)) {
                    const arrayStr = value.join('; ');
                    return `"${this.sanitizeCSVValue(arrayStr)}"`;
                }
                // Sanitize and escape quotes and wrap in quotes if contains comma
                const sanitized = this.sanitizeCSVValue(value);
                return sanitized.includes(',') ? `"${sanitized}"` : sanitized;
            });
            csvRows.push(values.join(','));
        });

        // Create blob and download
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        this.downloadBlob(blob, `${filename}.csv`);
    }

    /**
     * Download data as JSON
     */
    downloadJSON(data, filename) {
        const jsonContent = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        this.downloadBlob(blob, `${filename}.json`);
    }

    /**
     * Download blob as file
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Delay URL.revokeObjectURL to ensure download starts
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    /**
     * Download contributor data as CSV or JSON
     */
    downloadContributorData(category, filename, format) {
        const data = this.contributorMetrics[category].data;

        if (!data || data.length === 0) {
            console.warn(`[Turnaround] No data available for download: ${category}`);
            return;
        }

        if (format === 'csv') {
            this.downloadCSV(data, filename);
        } else if (format === 'json') {
            this.downloadJSON(data, filename);
        }
    }

    /**
     * Load contributor metrics from API
     */
    async loadContributorMetrics() {
        console.log('[Turnaround] Loading contributor metrics');

        // Get filters
        const filters = this.getTimeFilters();

        // Fetch all contributor categories in parallel
        await Promise.all([
            this.loadContributorCategory('pr_creators', filters),
            this.loadContributorCategory('pr_reviewers', filters),
            this.loadContributorCategory('pr_approvers', filters),
            this.loadContributorCategory('pr_lgtm', filters)
        ]);
    }

    /**
     * Load a specific contributor category
     */
    async loadContributorCategory(category, filters = {}) {
        try {
            const page = this.contributorMetrics[category].currentPage;
            const params = {
                ...filters,
                page: page,
                page_size: 10
            };

            console.log(`[Turnaround] Fetching ${category} metrics, page ${page}`);

            const response = await apiClient.fetchContributors(
                params.start_time,
                params.end_time,
                10,
                {
                    repository: params.repository,
                    user: params.user,
                    page: params.page,
                    page_size: params.page_size
                }
            );

            if (response.error) {
                console.error(`[Turnaround] Error loading ${category}:`, response.error);
                this.showContributorCategoryError(category, response.detail || response.error);
                return;
            }

            // Store data and pagination
            this.contributorMetrics[category].data = response[category]?.data || [];
            this.contributorMetrics[category].pagination = response[category]?.pagination || null;

            console.log(`[Turnaround] ${category} loaded:`, {
                count: this.contributorMetrics[category].data.length,
                pagination: this.contributorMetrics[category].pagination
            });

            // Update table
            this.updateContributorTable(category);
            this.updateContributorPagination(category);

        } catch (error) {
            console.error(`[Turnaround] Error loading ${category}:`, error);
            this.showContributorCategoryError(category, error.message);
        }
    }

    /**
     * Update contributor table with data
     */
    updateContributorTable(category) {
        const tableBodyMap = {
            pr_creators: this.prCreatorsTableBody,
            pr_reviewers: this.prReviewersTableBody,
            pr_approvers: this.prApproversTableBody,
            pr_lgtm: this.prLgtmTableBody
        };

        const tableBody = tableBodyMap[category];
        if (!tableBody) {
            console.warn(`[Turnaround] Table body not found for ${category}`);
            return;
        }

        const data = this.contributorMetrics[category].data;

        // Clear existing rows
        tableBody.innerHTML = '';

        // Handle empty data
        if (!data || data.length === 0) {
            const colspan = category === 'pr_creators' ? 5 : category === 'pr_reviewers' ? 4 : 3;
            tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; padding: 20px; color: var(--text-secondary);">No data available</td></tr>`;
            return;
        }

        // Populate table based on category
        data.forEach(item => {
            const row = document.createElement('tr');

            if (category === 'pr_creators') {
                row.innerHTML = `
                    <td><a href="#" class="clickable-username" data-username="${this.escapeHtml(item.user)}">${this.escapeHtml(item.user)}</a></td>
                    <td>${item.total_prs || 0}</td>
                    <td>${item.merged_prs || 0}</td>
                    <td>${item.closed_prs || 0}</td>
                    <td>${item.avg_commits_per_pr ? parseFloat(item.avg_commits_per_pr).toFixed(1) : '0.0'}</td>
                `;
            } else if (category === 'pr_reviewers') {
                row.innerHTML = `
                    <td><a href="#" class="clickable-username" data-username="${this.escapeHtml(item.user)}">${this.escapeHtml(item.user)}</a></td>
                    <td>${item.total_reviews || 0}</td>
                    <td>${item.prs_reviewed || 0}</td>
                    <td>${item.avg_reviews_per_pr ? parseFloat(item.avg_reviews_per_pr).toFixed(1) : '0.0'}</td>
                `;
            } else if (category === 'pr_approvers') {
                row.innerHTML = `
                    <td><a href="#" class="clickable-username" data-username="${this.escapeHtml(item.user)}">${this.escapeHtml(item.user)}</a></td>
                    <td>${item.total_approvals || 0}</td>
                    <td>${item.prs_approved || 0}</td>
                `;
            } else if (category === 'pr_lgtm') {
                row.innerHTML = `
                    <td><a href="#" class="clickable-username" data-username="${this.escapeHtml(item.user)}">${this.escapeHtml(item.user)}</a></td>
                    <td>${item.total_lgtm || 0}</td>
                    <td>${item.prs_lgtm || 0}</td>
                `;
            }

            tableBody.appendChild(row);
        });

        // Set up click handlers for usernames
        this.setupUsernameClickHandlers(tableBody);
    }

    /**
     * Set up click handlers for usernames
     */
    setupUsernameClickHandlers(tableBody) {
        const usernameLinks = tableBody.querySelectorAll('.clickable-username');
        console.log(`[Turnaround] Setting up click handlers for ${usernameLinks.length} username links`);
        usernameLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent dashboard.js global handler from firing
                const username = e.currentTarget.dataset.username;
                if (username) {
                    this.showUserPrsModal(username);
                }
            });
        });
    }

    /**
     * Show modal with user's PRs
     */
    async showUserPrsModal(username) {
        console.log(`[Turnaround] Opening PRs modal for ${username}`);

        // Show modal
        const modal = document.getElementById('userPrsModal');
        const modalTitle = document.getElementById('userPrsUsername');
        const modalBody = document.getElementById('userPrsModalBody');
        const loadingEl = document.getElementById('userPrsLoading');
        const prsList = document.getElementById('userPrsList');

        if (!modal || !modalTitle || !prsList) {
            console.error('[Turnaround] Modal elements not found');
            return;
        }

        // Set username in title
        modalTitle.textContent = username;

        // Show modal and loading state
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        loadingEl.style.display = 'flex';
        prsList.innerHTML = '';

        // Set up close button handler
        const closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeUserPrsModal();
        }

        // Close on click outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeUserPrsModal();
            }
        };

        // Close on ESC key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeUserPrsModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Fetch user PRs
        try {
            const filters = this.getTimeFilters();
            const params = new URLSearchParams({
                user: username,
                page: '1',
                page_size: '50'
            });

            if (filters.start_time) params.append('start_time', filters.start_time);
            if (filters.end_time) params.append('end_time', filters.end_time);
            if (filters.repository) params.append('repository', filters.repository);

            const response = await fetch(`/api/metrics/user-prs?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Hide loading
            loadingEl.style.display = 'none';

            // Render PRs
            this.renderUserPrsList(data.data, username);

        } catch (error) {
            console.error('[Turnaround] Error loading user PRs:', error);
            loadingEl.style.display = 'none';
            prsList.innerHTML = `<div class="error-message">Failed to load PRs: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    /**
     * Close user PRs modal
     */
    closeUserPrsModal() {
        const modal = document.getElementById('userPrsModal');
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }

    /**
     * Render list of user PRs
     */
    renderUserPrsList(prs, username) {
        const prsList = document.getElementById('userPrsList');
        if (!prsList) return;

        if (!prs || prs.length === 0) {
            prsList.innerHTML = '<div class="empty-state">No PRs found for this user in the selected time range.</div>';
            return;
        }

        const prsHtml = prs.map((pr, index) => {
            const stateClass = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
            const stateLabel = pr.merged ? 'merged' : pr.state;
            const prId = `user-pr-${index}`;

            return `
                <div class="user-pr-item" data-pr-id="${prId}">
                    <div class="user-pr-header" onclick="window.turnaroundMetrics.togglePrStory('${prId}', '${this.escapeHtml(pr.repository)}', ${pr.number})">
                        <div class="user-pr-title">
                            <span class="user-pr-expand-icon" id="${prId}-icon">▶</span>
                            <span class="pr-number">#${pr.number}</span>
                            <span class="pr-title">${this.escapeHtml(pr.title)}</span>
                        </div>
                        <div class="user-pr-meta">
                            <span class="pr-repo">${this.escapeHtml(pr.repository)}</span>
                            <span class="pr-state pr-state-${stateClass}">${stateLabel}</span>
                            <span class="pr-date">${this.formatDate(pr.created_at)}</span>
                            <span class="pr-commits">${pr.commits_count} commit${pr.commits_count !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                    <div class="user-pr-story" id="${prId}-story" style="display: none;">
                        <div class="pr-story-loading">Loading PR timeline...</div>
                    </div>
                </div>
            `;
        }).join('');

        prsList.innerHTML = prsHtml;
    }

    /**
     * Toggle PR story visibility and load if needed
     */
    async togglePrStory(prId, repository, prNumber) {
        const storyContainer = document.getElementById(`${prId}-story`);
        const expandIcon = document.getElementById(`${prId}-icon`);

        if (!storyContainer || !expandIcon) return;

        // Toggle visibility
        if (storyContainer.style.display === 'none') {
            storyContainer.style.display = 'block';
            expandIcon.textContent = '▼';

            // Load PR story if not already loaded
            if (storyContainer.innerHTML.includes('Loading PR timeline')) {
                await this.loadPrStory(prId, repository, prNumber);
            }
        } else {
            storyContainer.style.display = 'none';
            expandIcon.textContent = '▶';
        }
    }

    /**
     * Load and render PR story timeline
     */
    async loadPrStory(prId, repository, prNumber) {
        const storyContainer = document.getElementById(`${prId}-story`);
        if (!storyContainer) return;

        try {
            const response = await fetch(`/api/metrics/pr-story/${encodeURIComponent(repository)}/${prNumber}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Render PR story timeline
            storyContainer.innerHTML = this.renderPrStoryTimeline(data);

        } catch (error) {
            console.error(`[Turnaround] Error loading PR story for ${repository}#${prNumber}:`, error);
            storyContainer.innerHTML = `<div class="error-message">Failed to load PR timeline: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    /**
     * Render PR story timeline
     */
    renderPrStoryTimeline(storyData) {
        const { events, summary } = storyData;

        if (!events || events.length === 0) {
            return '<div class="empty-state">No timeline events found for this PR.</div>';
        }

        // Summary header
        const summaryHtml = `
            <div class="pr-story-summary">
                <span>📝 ${summary.total_commits} commits</span>
                <span>💬 ${summary.total_reviews} reviews</span>
                <span>▶️ ${summary.total_check_runs} check runs</span>
                <span>💭 ${summary.total_comments} comments</span>
            </div>
        `;

        // Timeline events
        const eventsHtml = events.map(event => this.renderTimelineEvent(event)).join('');

        return `
            ${summaryHtml}
            <div class="pr-timeline">
                ${eventsHtml}
            </div>
        `;
    }

    /**
     * Render a single timeline event
     */
    renderTimelineEvent(event) {
        const eventConfig = this.getEventConfig(event.event_type);
        const icon = eventConfig.icon;
        const label = eventConfig.label;

        let descriptionHtml = '';
        if (event.description) {
            descriptionHtml = `<div class="timeline-event-description">${this.escapeHtml(event.description)}</div>`;
        }

        const timeStr = this.formatTimestamp(event.timestamp);

        return `
            <div class="timeline-event-item">
                <div class="timeline-event-marker"></div>
                <div class="timeline-event-content">
                    <div class="timeline-event-header">
                        <span class="timeline-event-icon">${icon}</span>
                        <span class="timeline-event-title">${this.escapeHtml(label)}</span>
                        <span class="timeline-event-time">${timeStr}</span>
                    </div>
                    ${descriptionHtml}
                </div>
            </div>
        `;
    }

    /**
     * Get event configuration (icon, label)
     */
    getEventConfig(eventType) {
        const configs = {
            pr_opened: { icon: '🔀', label: 'PR Opened' },
            pr_closed: { icon: '❌', label: 'PR Closed' },
            pr_merged: { icon: '🟣', label: 'Merged' },
            pr_reopened: { icon: '🔄', label: 'Reopened' },
            commit: { icon: '📝', label: 'Commit' },
            review_approved: { icon: '✅', label: 'Approved' },
            review_changes: { icon: '🔄', label: 'Changes Requested' },
            review_comment: { icon: '💬', label: 'Review Comment' },
            comment: { icon: '💬', label: 'Comment' },
            review_requested: { icon: '👁️', label: 'Review Requested' },
            ready_for_review: { icon: '👁️', label: 'Ready for Review' },
            label_added: { icon: '🏷️', label: 'Label Added' },
            label_removed: { icon: '🏷️', label: 'Label Removed' },
            verified: { icon: '🛡️', label: 'Verified' },
            approved_label: { icon: '✅', label: 'Approved' },
            lgtm: { icon: '👍', label: 'LGTM' },
            check_run: { icon: '▶️', label: 'Check Run' }
        };

        return configs[eventType] || { icon: '●', label: eventType };
    }

    /**
     * Format timestamp for display
     */
    formatTimestamp(timestamp) {
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (minutes < 1) return 'just now';
            if (minutes < 60) return `${minutes}m ago`;
            if (hours < 24) return `${hours}h ago`;
            if (days < 7) return `${days}d ago`;

            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return timestamp;
        }
    }

    /**
     * Format date for PR list
     */
    formatDate(timestamp) {
        try {
            const date = new Date(timestamp);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return timestamp;
        }
    }

    /**
     * Update pagination controls for a contributor category
     */
    updateContributorPagination(category) {
        const pagination = this.contributorMetrics[category].pagination;
        if (!pagination) {
            return;
        }

        const categoryPrefix = this.getCategoryPrefix(category);

        // Update page info
        const pageInfo = document.getElementById(`${categoryPrefix}-page-info`);
        if (pageInfo) {
            pageInfo.textContent = `Page ${pagination.page} of ${pagination.total_pages}`;
        }

        // Update buttons
        const prevBtn = document.getElementById(`${categoryPrefix}-prev`);
        const nextBtn = document.getElementById(`${categoryPrefix}-next`);

        if (prevBtn) {
            prevBtn.disabled = !pagination.has_prev;
        }

        if (nextBtn) {
            nextBtn.disabled = !pagination.has_next;
        }
    }

    /**
     * Get category prefix for element IDs
     */
    getCategoryPrefix(category) {
        const prefixMap = {
            pr_creators: 'prCreators',
            pr_reviewers: 'prReviewers',
            pr_approvers: 'prApprovers',
            pr_lgtm: 'prLgtm'
        };
        return prefixMap[category] || category;
    }

    /**
     * Show error for a specific contributor category
     */
    showContributorCategoryError(category, message) {
        const tableBodyMap = {
            pr_creators: this.prCreatorsTableBody,
            pr_reviewers: this.prReviewersTableBody,
            pr_approvers: this.prApproversTableBody,
            pr_lgtm: this.prLgtmTableBody
        };

        const tableBody = tableBodyMap[category];
        if (!tableBody) {
            return;
        }

        const colspan = category === 'pr_creators' ? 5 : category === 'pr_reviewers' ? 4 : 3;
        tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; padding: 20px; color: var(--error-color);">Error: ${this.escapeHtml(message)}</td></tr>`;
    }

    /**
     * Set up pagination controls for contributor metrics
     */
    setupContributorPagination() {
        const categories = ['pr_creators', 'pr_reviewers', 'pr_approvers', 'pr_lgtm'];

        categories.forEach(category => {
            const categoryPrefix = this.getCategoryPrefix(category);

            const prevBtn = document.getElementById(`${categoryPrefix}-prev`);
            const nextBtn = document.getElementById(`${categoryPrefix}-next`);

            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    this.contributorMetrics[category].currentPage--;
                    this.loadContributorCategory(category, this.getTimeFilters());
                });
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    this.contributorMetrics[category].currentPage++;
                    this.loadContributorCategory(category, this.getTimeFilters());
                });
            }
        });
    }

    /**
     * Set up sorting for contributor tables
     */
    setupContributorTableSorting(table, category) {
        const headers = table.querySelectorAll('th.sortable');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.column;
                this.sortContributorTable(table, category, column);
            });
        });
    }

    /**
     * Sort contributor table by column
     */
    sortContributorTable(table, category, column) {
        const data = this.contributorMetrics[category].data;
        if (!data || data.length === 0) {
            return;
        }

        const headers = table.querySelectorAll('th.sortable');
        const clickedHeader = Array.from(headers).find(h => h.dataset.column === column);

        // Determine sort direction
        let direction = 'asc';
        if (clickedHeader.classList.contains('sort-asc')) {
            direction = 'desc';
        } else if (clickedHeader.classList.contains('sort-desc')) {
            direction = 'asc';
        }

        // Clear all sort indicators
        headers.forEach(h => {
            h.classList.remove('sort-asc', 'sort-desc');
        });

        // Set new sort indicator
        clickedHeader.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

        // Sort data
        const sortedData = [...data].sort((a, b) => {
            const aVal = a[column];
            const bVal = b[column];

            // Handle null/undefined
            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;

            // Compare values
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            } else {
                const aStr = String(aVal).toLowerCase();
                const bStr = String(bVal).toLowerCase();
                return direction === 'asc'
                    ? aStr.localeCompare(bStr)
                    : bStr.localeCompare(aStr);
            }
        });

        // Update data and re-render table
        this.contributorMetrics[category].data = sortedData;
        this.updateContributorTable(category);
    }
}

// Initialize turnaround metrics when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.turnaroundMetrics = new TurnaroundMetrics();
    });
} else {
    window.turnaroundMetrics = new TurnaroundMetrics();
}

// Export for module usage
export { TurnaroundMetrics };
