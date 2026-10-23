// Every document the plugin sends. test/unit/queries.test.ts validates each one against
// Linear's published GraphQL schema, so a misspelt field fails a test rather than a user.

const ISSUE_CARD = /* GraphQL */ `
  fragment IssueCard on Issue {
    id
    identifier
    title
    priority
    createdAt
    updatedAt
    url
    sortOrder
    state { id }
    parent { identifier title }
    assignee { id name }
    project { id name color }
    labels(first: 6) { nodes { id name color } }
    attachments(first: 10) { nodes { sourceType url metadata } }
    children(first: 50) { nodes { state { type } } }
  }
`;

export const VIEWER = /* GraphQL */ `
  query Viewer {
    viewer { id name displayName }
    organization { name }
  }
`;

export const TEAMS = /* GraphQL */ `
  query Teams {
    teams(first: 100) { nodes { id key name color } }
  }
`;

export const TEAM_SETUP = /* GraphQL */ `
  query TeamSetup($teamId: String!, $teamFilterId: ID!) {
    team(id: $teamId) {
      id
      states(first: 100) { nodes { id name type color position } }
      projects(first: 100) { nodes { id name color } }
    }
    customViews(first: 100, filter: { team: { id: { eq: $teamFilterId } } }) {
      nodes { id name color }
    }
  }
`;

export const COLUMN_ISSUES = /* GraphQL */ `
  ${ISSUE_CARD}
  query ColumnIssues($filter: IssueFilter!, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes { ...IssueCard }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const VIEW_COLUMN_ISSUES = /* GraphQL */ `
  ${ISSUE_CARD}
  query ViewColumnIssues($viewId: String!, $filter: IssueFilter!, $first: Int!, $after: String) {
    customView(id: $viewId) {
      issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
        nodes { ...IssueCard }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/** One cheap question for the refresh timer: did anything in the team change, and what is the newest change? */
export const CHANGED_SINCE = /* GraphQL */ `
  query ChangedSince($filter: IssueFilter!) {
    issues(filter: $filter, first: 1, includeArchived: true, orderBy: updatedAt) { nodes { id updatedAt } }
  }
`;

export const ISSUE_DETAIL = /* GraphQL */ `
  query IssueDetail($id: String!) {
    issue(id: $id) {
      id
      description
      dueDate
      estimate
      creator { name }
      subIssues: children(first: 50) {
        nodes { id identifier title state { name type color } }
      }
    }
  }
`;

export const MOVE_ISSUE = /* GraphQL */ `
  ${ISSUE_CARD}
  mutation MoveIssue($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { ...IssueCard }
    }
  }
`;

export const DOCUMENTS = {
  Viewer: VIEWER,
  Teams: TEAMS,
  TeamSetup: TEAM_SETUP,
  ColumnIssues: COLUMN_ISSUES,
  ViewColumnIssues: VIEW_COLUMN_ISSUES,
  ChangedSince: CHANGED_SINCE,
  IssueDetail: ISSUE_DETAIL,
  MoveIssue: MOVE_ISSUE,
} as const;
