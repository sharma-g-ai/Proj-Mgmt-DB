/**
 * InfraSpecs Add Resource schemas — matches Cloud/Tool → Service Type → fields.
 * Monthly cost intentionally omitted until requested.
 */

export type ResourceFieldDataType = "text" | "number" | "boolean" | "date";

export type ResourceFieldDef = {
  key: string;
  label: string;
  dataType: ResourceFieldDataType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  suggestions?: string[];
  /** Optional unit selector stored as `${key}_unit` */
  unitOptions?: string[];
  unitKey?: string;
  fullWidth?: boolean;
};

/** Single dropdown: which cloud OR which tool. */
export const CLOUD_OR_TOOL_OPTIONS = [
  "AWS",
  "Microsoft Azure",
  "GCP",
  "E2E Cloud",
  "Oracle Cloud",
  "DigitalOcean",
  "Atlassian",
  "Jira",
  "GitHub",
  "GitHub Copilot",
  "Microsoft 365",
  "Datadog",
  "Custom / Other",
] as const;

export type CloudOrTool = (typeof CLOUD_OR_TOOL_OPTIONS)[number] | string;

export type ServiceOption = {
  value: string;
  label: string;
  /** Schema key for field set */
  schemaKey: string;
  /** Provider-style category: Compute, Database, Networking, SaaS, … */
  category: string;
};

export const ENV_OPTIONS = [
  "Production",
  "Staging",
  "UAT",
  "Development",
  "DR",
  "Shared",
] as const;

export const UNSPECIFIED_ENVIRONMENT = "Unspecified";

const ENV_FIELD: ResourceFieldDef = {
  key: "environment",
  label: "Environment",
  dataType: "text",
  required: true,
  options: [...ENV_OPTIONS],
};

/** Normalized environment from resource attributes (for grouping / filters). */
export function resourceEnvironmentLabel(
  attrs: Record<string, unknown> | null | undefined
): string {
  const raw = attrs?.environment;
  if (typeof raw !== "string") return UNSPECIFIED_ENVIRONMENT;
  const t = raw.trim();
  return t || UNSPECIFIED_ENVIRONMENT;
}

const REGION_FIELD: ResourceFieldDef = {
  key: "region",
  label: "Region",
  dataType: "text",
  required: true,
  placeholder: "e.g. us-east-1",
  suggestions: [
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "ap-south-1",
    "ap-southeast-1",
    "eastus",
    "westus2",
    "centralindia",
  ],
};

/** EC2 / VM style — from your AWS example (no monthly cost). */
const EC2_FIELDS: ResourceFieldDef[] = [
  {
    key: "instance_type",
    label: "Instance type / size",
    dataType: "text",
    required: true,
    placeholder: "e.g. t3.micro",
  },
  { key: "vcpu", label: "vCPUs Count", dataType: "number", required: true, placeholder: "2" },
  { key: "memory_gb", label: "RAM (GB)", dataType: "number", required: true, placeholder: "1" },
  { key: "storage_gb", label: "Storage (GB)", dataType: "number", required: true, placeholder: "30" },
  ENV_FIELD,
  REGION_FIELD,
  {
    key: "ip_address",
    label: "IP Address",
    dataType: "text",
    placeholder: "e.g. 164.52.204.208",
    fullWidth: true,
  },
];

const RDS_FIELDS: ResourceFieldDef[] = [
  {
    key: "engine",
    label: "Engine",
    dataType: "text",
    required: true,
    options: ["PostgreSQL", "MySQL", "MariaDB", "SQL Server", "Oracle", "Aurora", "Other"],
  },
  { key: "engine_version", label: "Engine version", dataType: "text", placeholder: "15.4" },
  {
    key: "instance_class",
    label: "Instance class",
    dataType: "text",
    required: true,
    placeholder: "db.t3.micro",
  },
  { key: "storage_gb", label: "Storage (GB)", dataType: "number", required: true },
  ENV_FIELD,
  REGION_FIELD,
];

const VPC_FIELDS: ResourceFieldDef[] = [
  { key: "cidr_block", label: "CIDR block", dataType: "text", required: true, placeholder: "10.0.0.0/16" },
  ENV_FIELD,
  REGION_FIELD,
];

const S3_FIELDS: ResourceFieldDef[] = [
  {
    key: "storage_class",
    label: "Storage class",
    dataType: "text",
    options: ["STANDARD", "STANDARD_IA", "GLACIER", "INTELLIGENT_TIERING", "Other"],
  },
  ENV_FIELD,
  REGION_FIELD,
];

const LB_FIELDS: ResourceFieldDef[] = [
  {
    key: "lb_type",
    label: "Load balancer type",
    dataType: "text",
    required: true,
    options: ["ALB", "NLB", "CLB", "Application Gateway", "Other"],
  },
  { key: "scheme", label: "Scheme", dataType: "text", options: ["internet-facing", "internal"] },
  ENV_FIELD,
  REGION_FIELD,
];

const GENERIC_CLOUD_FIELDS: ResourceFieldDef[] = [
  ENV_FIELD,
  REGION_FIELD,
  { key: "notes_detail", label: "Details", dataType: "text", placeholder: "Size, SKU, config…", fullWidth: true },
];

/**
 * Form when the user picks “Other / Custom service” — enough to describe it,
 * without the full EC2-style field set.
 */
const OTHER_CUSTOM_FIELDS: ResourceFieldDef[] = [
  {
    key: "custom_service_name",
    label: "Custom service name",
    dataType: "text",
    required: true,
    placeholder: "e.g. AWS Config, internal API, Datadog host…",
    fullWidth: true,
  },
  {
    key: "instance_type",
    label: "Size / SKU / plan",
    dataType: "text",
    placeholder: "e.g. t3.medium, Business, 10 seats",
  },
  ENV_FIELD,
  REGION_FIELD,
];

/** Copilot / seat-based tools — from your GitHub Copilot example. */
const SEATS_FIELDS: ResourceFieldDef[] = [
  {
    key: "seats",
    label: "Billed seats / agents",
    dataType: "number",
    required: true,
    placeholder: "e.g. 46",
    unitKey: "seat_unit",
    unitOptions: ["Users", "Agents", "Seats", "Licenses"],
  },
  ENV_FIELD,
];

const JIRA_FIELDS: ResourceFieldDef[] = [
  {
    key: "workspace_url",
    label: "Site / workspace URL",
    dataType: "text",
    required: true,
    placeholder: "https://company.atlassian.net",
    fullWidth: true,
  },
  {
    key: "seats",
    label: "Billed seats / agents",
    dataType: "number",
    required: true,
    placeholder: "e.g. 46",
    unitKey: "seat_unit",
    unitOptions: ["Users", "Agents", "Seats", "Licenses"],
  },
  { key: "plan", label: "Plan", dataType: "text", options: ["Free", "Standard", "Premium", "Enterprise"] },
  ENV_FIELD,
];

const LICENSE_FIELDS: ResourceFieldDef[] = [
  {
    key: "seats",
    label: "Billed seats / agents",
    dataType: "number",
    required: true,
    placeholder: "e.g. 10",
    unitKey: "seat_unit",
    unitOptions: ["Users", "Seats", "Licenses"],
  },
  { key: "plan", label: "Plan", dataType: "text", placeholder: "Business / Enterprise" },
  ENV_FIELD,
];

const CUSTOM_FIELDS: ResourceFieldDef[] = OTHER_CUSTOM_FIELDS;

const LAMBDA_FIELDS: ResourceFieldDef[] = [
  {
    key: "runtime",
    label: "Runtime",
    dataType: "text",
    required: true,
    placeholder: "e.g. nodejs20.x, python3.12",
  },
  { key: "memory_mb", label: "Memory (MB)", dataType: "number", placeholder: "128" },
  { key: "timeout_sec", label: "Timeout (sec)", dataType: "number", placeholder: "30" },
  ENV_FIELD,
  REGION_FIELD,
];

const K8S_FIELDS: ResourceFieldDef[] = [
  { key: "cluster_version", label: "Cluster version", dataType: "text", placeholder: "e.g. 1.29" },
  { key: "node_group", label: "Node group / pool", dataType: "text" },
  {
    key: "node_instance_type",
    label: "Node instance type",
    dataType: "text",
    placeholder: "e.g. m5.large",
  },
  ENV_FIELD,
  REGION_FIELD,
];

const CACHE_FIELDS: ResourceFieldDef[] = [
  {
    key: "engine",
    label: "Engine",
    dataType: "text",
    required: true,
    options: ["Redis", "Memcached", "Other"],
  },
  {
    key: "node_type",
    label: "Node type",
    dataType: "text",
    required: true,
    placeholder: "e.g. cache.t3.micro",
  },
  { key: "nodes", label: "Node count", dataType: "number", placeholder: "1" },
  ENV_FIELD,
  REGION_FIELD,
];

const NAT_FIELDS: ResourceFieldDef[] = [
  { key: "connectivity", label: "Connectivity", dataType: "text", options: ["public", "private"] },
  { key: "elastic_ip", label: "Elastic / public IP", dataType: "text" },
  ENV_FIELD,
  REGION_FIELD,
];

const SUBNET_FIELDS: ResourceFieldDef[] = [
  {
    key: "cidr_block",
    label: "CIDR block",
    dataType: "text",
    required: true,
    placeholder: "e.g. 10.0.1.0/24",
  },
  { key: "availability_zone", label: "Availability zone", dataType: "text", required: true },
  {
    key: "subnet_kind",
    label: "Subnet kind",
    dataType: "text",
    options: ["public", "private", "isolated"],
  },
  ENV_FIELD,
  REGION_FIELD,
];

const SG_FIELDS: ResourceFieldDef[] = [
  { key: "vpc_id", label: "VPC / VNet ID", dataType: "text", placeholder: "vpc-0abc…" },
  {
    key: "inbound_summary",
    label: "Inbound rules (summary)",
    dataType: "text",
    placeholder: "e.g. 443 from ALB SG",
    fullWidth: true,
  },
  ENV_FIELD,
  REGION_FIELD,
];

const VOLUME_FIELDS: ResourceFieldDef[] = [
  {
    key: "volume_type",
    label: "Volume type",
    dataType: "text",
    required: true,
    options: ["gp3", "gp2", "io1", "io2", "st1", "sc1", "Premium SSD", "Standard HDD", "Other"],
  },
  { key: "size_gb", label: "Size (GB)", dataType: "number", required: true },
  { key: "attached_to", label: "Attached to", dataType: "text", placeholder: "instance name or ID" },
  ENV_FIELD,
  REGION_FIELD,
];

const CDN_FIELDS: ResourceFieldDef[] = [
  {
    key: "distribution_domain",
    label: "Distribution / endpoint",
    dataType: "text",
    placeholder: "d111111abcdef8.cloudfront.net",
    fullWidth: true,
  },
  { key: "origin", label: "Origin", dataType: "text" },
  ENV_FIELD,
  REGION_FIELD,
];

const DNS_FIELDS: ResourceFieldDef[] = [
  { key: "hosted_zone", label: "Hosted zone / DNS name", dataType: "text", required: true },
  { key: "record_summary", label: "Records (summary)", dataType: "text", placeholder: "A, CNAME, MX…" },
  ENV_FIELD,
];

const QUEUE_FIELDS: ResourceFieldDef[] = [
  {
    key: "queue_type",
    label: "Queue / topic type",
    dataType: "text",
    options: ["SQS", "SNS", "Service Bus", "Pub/Sub", "Kafka", "Other"],
  },
  ENV_FIELD,
  REGION_FIELD,
];

const EIP_FIELDS: ResourceFieldDef[] = [
  { key: "public_ip", label: "Public IP", dataType: "text", required: true },
  {
    key: "associated_with",
    label: "Associated with",
    dataType: "text",
    placeholder: "instance / NAT / LB",
  },
  ENV_FIELD,
  REGION_FIELD,
];

export const SCHEMA_FIELDS: Record<string, ResourceFieldDef[]> = {
  ec2: EC2_FIELDS,
  vm: EC2_FIELDS,
  rds: RDS_FIELDS,
  vpc: VPC_FIELDS,
  s3: S3_FIELDS,
  lb: LB_FIELDS,
  lambda: LAMBDA_FIELDS,
  k8s: K8S_FIELDS,
  cache: CACHE_FIELDS,
  nat: NAT_FIELDS,
  subnet: SUBNET_FIELDS,
  sg: SG_FIELDS,
  volume: VOLUME_FIELDS,
  cdn: CDN_FIELDS,
  dns: DNS_FIELDS,
  queue: QUEUE_FIELDS,
  eip: EIP_FIELDS,
  cloud_generic: GENERIC_CLOUD_FIELDS,
  other_custom: OTHER_CUSTOM_FIELDS,
  seats: SEATS_FIELDS,
  jira: JIRA_FIELDS,
  license: LICENSE_FIELDS,
  custom: OTHER_CUSTOM_FIELDS,
};

/** Services offered per Cloud / Tool — grouped like each provider’s own catalog. */
export const SERVICES_BY_PROVIDER: Record<string, ServiceOption[]> = {
  AWS: [
    // Compute
    { category: "Compute", value: "EC2 — Virtual Server", label: "EC2 — Virtual Server", schemaKey: "ec2" },
    { category: "Compute", value: "Lambda — Serverless Functions", label: "Lambda — Serverless Functions", schemaKey: "lambda" },
    { category: "Compute", value: "ECS — Container Service", label: "ECS — Container Service", schemaKey: "k8s" },
    { category: "Compute", value: "EKS — Kubernetes", label: "EKS — Kubernetes", schemaKey: "k8s" },
    { category: "Compute", value: "Fargate", label: "Fargate", schemaKey: "k8s" },
    { category: "Compute", value: "AWS Batch", label: "AWS Batch", schemaKey: "cloud_generic" },
    { category: "Compute", value: "Lightsail — Simple VPS", label: "Lightsail — Simple VPS", schemaKey: "vm" },
    { category: "Compute", value: "Elastic Beanstalk", label: "Elastic Beanstalk", schemaKey: "cloud_generic" },
    { category: "Compute", value: "App Runner", label: "App Runner", schemaKey: "cloud_generic" },
    { category: "Compute", value: "EC2 Auto Scaling", label: "EC2 Auto Scaling", schemaKey: "cloud_generic" },
    { category: "Compute", value: "EC2 Image Builder", label: "EC2 Image Builder", schemaKey: "cloud_generic" },
    // Containers / registry
    { category: "Containers", value: "ECR — Container Registry", label: "ECR — Container Registry", schemaKey: "cloud_generic" },
    { category: "Containers", value: "App Mesh", label: "App Mesh", schemaKey: "cloud_generic" },
    // Database
    { category: "Database", value: "RDS — Relational Database", label: "RDS — Relational Database", schemaKey: "rds" },
    { category: "Database", value: "Aurora — Managed SQL", label: "Aurora — Managed SQL", schemaKey: "rds" },
    { category: "Database", value: "DynamoDB — NoSQL Database", label: "DynamoDB — NoSQL Database", schemaKey: "cloud_generic" },
    { category: "Database", value: "ElastiCache — Redis / Memcached", label: "ElastiCache — Redis / Memcached", schemaKey: "cache" },
    { category: "Database", value: "MemoryDB for Redis", label: "MemoryDB for Redis", schemaKey: "cache" },
    { category: "Database", value: "DocumentDB — MongoDB-compatible", label: "DocumentDB — MongoDB-compatible", schemaKey: "rds" },
    { category: "Database", value: "Neptune — Graph Database", label: "Neptune — Graph Database", schemaKey: "cloud_generic" },
    { category: "Database", value: "Keyspaces — Cassandra", label: "Keyspaces — Cassandra", schemaKey: "cloud_generic" },
    { category: "Database", value: "Timestream", label: "Timestream", schemaKey: "cloud_generic" },
    { category: "Database", value: "QLDB", label: "QLDB", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Redshift — Data Warehouse", label: "Redshift — Data Warehouse", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Athena", label: "Athena", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Glue", label: "Glue", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "EMR", label: "EMR", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Kinesis Data Streams", label: "Kinesis Data Streams", schemaKey: "queue" },
    { category: "Analytics", value: "Kinesis Data Firehose", label: "Kinesis Data Firehose", schemaKey: "queue" },
    { category: "Analytics", value: "MSK — Managed Kafka", label: "MSK — Managed Kafka", schemaKey: "queue" },
    { category: "Analytics", value: "OpenSearch Service", label: "OpenSearch Service", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "QuickSight", label: "QuickSight", schemaKey: "cloud_generic" },
    // Storage
    { category: "Storage", value: "S3 — Object Storage", label: "S3 — Object Storage", schemaKey: "s3" },
    { category: "Storage", value: "EBS — Block Volume", label: "EBS — Block Volume", schemaKey: "volume" },
    { category: "Storage", value: "EFS — File System", label: "EFS — File System", schemaKey: "cloud_generic" },
    { category: "Storage", value: "FSx — File System", label: "FSx — File System", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Glacier — Archive", label: "Glacier — Archive", schemaKey: "s3" },
    { category: "Storage", value: "S3 Glacier Deep Archive", label: "S3 Glacier Deep Archive", schemaKey: "s3" },
    { category: "Storage", value: "Storage Gateway", label: "Storage Gateway", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Backup", label: "Backup", schemaKey: "cloud_generic" },
    // Networking
    { category: "Networking", value: "VPC — Virtual Private Cloud", label: "VPC — Virtual Private Cloud", schemaKey: "vpc" },
    { category: "Networking", value: "Subnet", label: "Subnet", schemaKey: "subnet" },
    { category: "Networking", value: "Security Group", label: "Security Group", schemaKey: "sg" },
    { category: "Networking", value: "Network ACL", label: "Network ACL", schemaKey: "sg" },
    { category: "Networking", value: "NAT Gateway", label: "NAT Gateway", schemaKey: "nat" },
    { category: "Networking", value: "Internet Gateway", label: "Internet Gateway", schemaKey: "cloud_generic" },
    { category: "Networking", value: "Transit Gateway", label: "Transit Gateway", schemaKey: "cloud_generic" },
    { category: "Networking", value: "VPN Connection", label: "VPN Connection", schemaKey: "cloud_generic" },
    { category: "Networking", value: "Direct Connect", label: "Direct Connect", schemaKey: "cloud_generic" },
    { category: "Networking", value: "PrivateLink / VPC Endpoint", label: "PrivateLink / VPC Endpoint", schemaKey: "cloud_generic" },
    { category: "Networking", value: "Elastic IP", label: "Elastic IP", schemaKey: "eip" },
    { category: "Networking", value: "ALB — Application Load Balancer", label: "ALB — Application Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "NLB — Network Load Balancer", label: "NLB — Network Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "Gateway Load Balancer", label: "Gateway Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "Global Accelerator", label: "Global Accelerator", schemaKey: "cloud_generic" },
    { category: "Networking", value: "CloudFront — CDN", label: "CloudFront — CDN", schemaKey: "cdn" },
    { category: "Networking", value: "Route 53 — DNS", label: "Route 53 — DNS", schemaKey: "dns" },
    { category: "Networking", value: "API Gateway", label: "API Gateway", schemaKey: "cloud_generic" },
    { category: "Networking", value: "AppSync — GraphQL", label: "AppSync — GraphQL", schemaKey: "cloud_generic" },
    // Integration
    { category: "Application integration", value: "SQS — Queue", label: "SQS — Queue", schemaKey: "queue" },
    { category: "Application integration", value: "SNS — Topic", label: "SNS — Topic", schemaKey: "queue" },
    { category: "Application integration", value: "EventBridge", label: "EventBridge", schemaKey: "queue" },
    { category: "Application integration", value: "Step Functions", label: "Step Functions", schemaKey: "cloud_generic" },
    { category: "Application integration", value: "MQ — Message Broker", label: "MQ — Message Broker", schemaKey: "queue" },
    { category: "Application integration", value: "SES — Email", label: "SES — Email", schemaKey: "cloud_generic" },
    { category: "Application integration", value: "Pinpoint", label: "Pinpoint", schemaKey: "cloud_generic" },
    // Security
    { category: "Security & identity", value: "IAM Role / User", label: "IAM Role / User", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "Cognito", label: "Cognito", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "Secrets Manager / SSM", label: "Secrets Manager / SSM", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "KMS / Encryption", label: "KMS / Encryption", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "WAF", label: "WAF", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "Shield", label: "Shield", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "GuardDuty", label: "GuardDuty", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "Security Hub", label: "Security Hub", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "Inspector", label: "Inspector", schemaKey: "cloud_generic" },
    { category: "Security & identity", value: "Certificate Manager (ACM)", label: "Certificate Manager (ACM)", schemaKey: "cloud_generic" },
    // Management / observability
    { category: "Management & monitoring", value: "CloudWatch", label: "CloudWatch", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "CloudTrail", label: "CloudTrail", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Config", label: "Config", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Systems Manager", label: "Systems Manager", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "X-Ray", label: "X-Ray", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Cost Explorer / Billing", label: "Cost Explorer / Billing", schemaKey: "cloud_generic" },
    // ML / developer
    { category: "Machine learning", value: "SageMaker", label: "SageMaker", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Bedrock", label: "Bedrock", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Rekognition", label: "Rekognition", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Comprehend", label: "Comprehend", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Translate", label: "Translate", schemaKey: "cloud_generic" },
    { category: "Developer tools", value: "CodeCommit", label: "CodeCommit", schemaKey: "cloud_generic" },
    { category: "Developer tools", value: "CodeBuild", label: "CodeBuild", schemaKey: "cloud_generic" },
    { category: "Developer tools", value: "CodePipeline", label: "CodePipeline", schemaKey: "cloud_generic" },
    { category: "Developer tools", value: "CodeDeploy", label: "CodeDeploy", schemaKey: "cloud_generic" },
    { category: "Developer tools", value: "Cloud9", label: "Cloud9", schemaKey: "cloud_generic" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "other_custom" },
  ],
  "Microsoft Azure": [
    { category: "Compute", value: "Virtual Machine", label: "Virtual Machine", schemaKey: "vm" },
    { category: "Compute", value: "Virtual Machine Scale Sets", label: "Virtual Machine Scale Sets", schemaKey: "vm" },
    { category: "Compute", value: "Azure Functions", label: "Azure Functions", schemaKey: "lambda" },
    { category: "Compute", value: "App Service", label: "App Service", schemaKey: "cloud_generic" },
    { category: "Compute", value: "Static Web Apps", label: "Static Web Apps", schemaKey: "cloud_generic" },
    { category: "Compute", value: "AKS — Kubernetes", label: "AKS — Kubernetes", schemaKey: "k8s" },
    { category: "Compute", value: "Container Instances", label: "Container Instances", schemaKey: "k8s" },
    { category: "Compute", value: "Container Apps", label: "Container Apps", schemaKey: "k8s" },
    { category: "Compute", value: "Batch", label: "Batch", schemaKey: "cloud_generic" },
    { category: "Compute", value: "Service Fabric", label: "Service Fabric", schemaKey: "cloud_generic" },
    { category: "Containers", value: "Azure Container Registry", label: "Azure Container Registry", schemaKey: "cloud_generic" },
    { category: "Database", value: "Azure SQL / Database", label: "Azure SQL / Database", schemaKey: "rds" },
    { category: "Database", value: "SQL Managed Instance", label: "SQL Managed Instance", schemaKey: "rds" },
    { category: "Database", value: "PostgreSQL Flexible Server", label: "PostgreSQL Flexible Server", schemaKey: "rds" },
    { category: "Database", value: "MySQL Flexible Server", label: "MySQL Flexible Server", schemaKey: "rds" },
    { category: "Database", value: "Cosmos DB", label: "Cosmos DB", schemaKey: "cloud_generic" },
    { category: "Database", value: "Azure Cache for Redis", label: "Azure Cache for Redis", schemaKey: "cache" },
    { category: "Database", value: "Table Storage", label: "Table Storage", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Synapse Analytics", label: "Synapse Analytics", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Data Factory", label: "Data Factory", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Databricks", label: "Databricks", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "HDInsight", label: "HDInsight", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Stream Analytics", label: "Stream Analytics", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Event Hubs", label: "Event Hubs", schemaKey: "queue" },
    { category: "Analytics", value: "Microsoft Fabric", label: "Microsoft Fabric", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Blob Storage", label: "Blob Storage", schemaKey: "s3" },
    { category: "Storage", value: "Managed Disk", label: "Managed Disk", schemaKey: "volume" },
    { category: "Storage", value: "Azure Files", label: "Azure Files", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Data Lake Storage", label: "Data Lake Storage", schemaKey: "s3" },
    { category: "Storage", value: "Backup Vault", label: "Backup Vault", schemaKey: "cloud_generic" },
    { category: "Networking", value: "VNet", label: "VNet", schemaKey: "vpc" },
    { category: "Networking", value: "Subnet", label: "Subnet", schemaKey: "subnet" },
    { category: "Networking", value: "NSG — Network Security Group", label: "NSG — Network Security Group", schemaKey: "sg" },
    { category: "Networking", value: "NAT Gateway", label: "NAT Gateway", schemaKey: "nat" },
    { category: "Networking", value: "Public IP", label: "Public IP", schemaKey: "eip" },
    { category: "Networking", value: "Load Balancer", label: "Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "Application Gateway", label: "Application Gateway", schemaKey: "lb" },
    { category: "Networking", value: "Front Door / CDN", label: "Front Door / CDN", schemaKey: "cdn" },
    { category: "Networking", value: "Traffic Manager", label: "Traffic Manager", schemaKey: "cdn" },
    { category: "Networking", value: "Azure DNS", label: "Azure DNS", schemaKey: "dns" },
    { category: "Networking", value: "Private Link / Endpoint", label: "Private Link / Endpoint", schemaKey: "cloud_generic" },
    { category: "Networking", value: "VPN Gateway", label: "VPN Gateway", schemaKey: "cloud_generic" },
    { category: "Networking", value: "ExpressRoute", label: "ExpressRoute", schemaKey: "cloud_generic" },
    { category: "Networking", value: "API Management", label: "API Management", schemaKey: "cloud_generic" },
    { category: "Integration", value: "Service Bus / Queue", label: "Service Bus / Queue", schemaKey: "queue" },
    { category: "Integration", value: "Event Grid", label: "Event Grid", schemaKey: "queue" },
    { category: "Integration", value: "Logic Apps", label: "Logic Apps", schemaKey: "cloud_generic" },
    { category: "Integration", value: "Notification Hubs", label: "Notification Hubs", schemaKey: "cloud_generic" },
    { category: "Security", value: "Key Vault", label: "Key Vault", schemaKey: "cloud_generic" },
    { category: "Security", value: "Microsoft Entra ID (Azure AD)", label: "Microsoft Entra ID (Azure AD)", schemaKey: "cloud_generic" },
    { category: "Security", value: "Defender for Cloud", label: "Defender for Cloud", schemaKey: "cloud_generic" },
    { category: "Security", value: "WAF / Firewall", label: "WAF / Firewall", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Monitor / Log Analytics", label: "Monitor / Log Analytics", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Application Insights", label: "Application Insights", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Automation Account", label: "Automation Account", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Azure Machine Learning", label: "Azure Machine Learning", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Cognitive Services / OpenAI", label: "Cognitive Services / OpenAI", schemaKey: "cloud_generic" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "other_custom" },
  ],
  GCP: [
    { category: "Compute", value: "Compute Engine", label: "Compute Engine", schemaKey: "vm" },
    { category: "Compute", value: "Cloud Functions", label: "Cloud Functions", schemaKey: "lambda" },
    { category: "Compute", value: "Cloud Run", label: "Cloud Run", schemaKey: "lambda" },
    { category: "Compute", value: "App Engine", label: "App Engine", schemaKey: "cloud_generic" },
    { category: "Compute", value: "GKE — Kubernetes", label: "GKE — Kubernetes", schemaKey: "k8s" },
    { category: "Compute", value: "Batch", label: "Batch", schemaKey: "cloud_generic" },
    { category: "Containers", value: "Artifact Registry", label: "Artifact Registry", schemaKey: "cloud_generic" },
    { category: "Containers", value: "Container Registry", label: "Container Registry", schemaKey: "cloud_generic" },
    { category: "Database", value: "Cloud SQL", label: "Cloud SQL", schemaKey: "rds" },
    { category: "Database", value: "Spanner", label: "Spanner", schemaKey: "cloud_generic" },
    { category: "Database", value: "Firestore", label: "Firestore", schemaKey: "cloud_generic" },
    { category: "Database", value: "Bigtable", label: "Bigtable", schemaKey: "cloud_generic" },
    { category: "Database", value: "Memorystore", label: "Memorystore", schemaKey: "cache" },
    { category: "Database", value: "Firebase Realtime Database", label: "Firebase Realtime Database", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "BigQuery", label: "BigQuery", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Dataflow", label: "Dataflow", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Dataproc", label: "Dataproc", schemaKey: "cloud_generic" },
    { category: "Analytics", value: "Pub/Sub", label: "Pub/Sub", schemaKey: "queue" },
    { category: "Analytics", value: "Data Studio / Looker", label: "Data Studio / Looker", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Cloud Storage", label: "Cloud Storage", schemaKey: "s3" },
    { category: "Storage", value: "Persistent Disk", label: "Persistent Disk", schemaKey: "volume" },
    { category: "Storage", value: "Filestore", label: "Filestore", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Backup and DR", label: "Backup and DR", schemaKey: "cloud_generic" },
    { category: "Networking", value: "VPC", label: "VPC", schemaKey: "vpc" },
    { category: "Networking", value: "Subnet", label: "Subnet", schemaKey: "subnet" },
    { category: "Networking", value: "Firewall Rule", label: "Firewall Rule", schemaKey: "sg" },
    { category: "Networking", value: "Cloud NAT", label: "Cloud NAT", schemaKey: "nat" },
    { category: "Networking", value: "External IP", label: "External IP", schemaKey: "eip" },
    { category: "Networking", value: "Cloud Load Balancing", label: "Cloud Load Balancing", schemaKey: "lb" },
    { category: "Networking", value: "Cloud CDN", label: "Cloud CDN", schemaKey: "cdn" },
    { category: "Networking", value: "Cloud DNS", label: "Cloud DNS", schemaKey: "dns" },
    { category: "Networking", value: "Cloud Armor", label: "Cloud Armor", schemaKey: "cloud_generic" },
    { category: "Networking", value: "Cloud Interconnect / VPN", label: "Cloud Interconnect / VPN", schemaKey: "cloud_generic" },
    { category: "Networking", value: "API Gateway", label: "API Gateway", schemaKey: "cloud_generic" },
    { category: "Security", value: "Secret Manager", label: "Secret Manager", schemaKey: "cloud_generic" },
    { category: "Security", value: "IAM", label: "IAM", schemaKey: "cloud_generic" },
    { category: "Security", value: "KMS", label: "KMS", schemaKey: "cloud_generic" },
    { category: "Security", value: "Identity Platform", label: "Identity Platform", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Cloud Monitoring", label: "Cloud Monitoring", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Cloud Logging", label: "Cloud Logging", schemaKey: "cloud_generic" },
    { category: "Management & monitoring", value: "Error Reporting", label: "Error Reporting", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Vertex AI", label: "Vertex AI", schemaKey: "cloud_generic" },
    { category: "Machine learning", value: "Document AI", label: "Document AI", schemaKey: "cloud_generic" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "other_custom" },
  ],
  "E2E Cloud": [
    { category: "Compute", value: "Virtual Machine (Compute Node)", label: "Virtual Machine (Compute Node)", schemaKey: "vm" },
    { category: "Compute", value: "Kubernetes Cluster", label: "Kubernetes Cluster", schemaKey: "k8s" },
    { category: "Compute", value: "Container Service", label: "Container Service", schemaKey: "k8s" },
    { category: "Compute", value: "Bare Metal Server", label: "Bare Metal Server", schemaKey: "vm" },
    { category: "Compute", value: "GPU Instance", label: "GPU Instance", schemaKey: "vm" },
    { category: "Compute", value: "Auto Scaling Group", label: "Auto Scaling Group", schemaKey: "cloud_generic" },
    { category: "Database", value: "MySQL Database", label: "MySQL Database", schemaKey: "rds" },
    { category: "Database", value: "PostgreSQL Database", label: "PostgreSQL Database", schemaKey: "rds" },
    { category: "Database", value: "MongoDB Database", label: "MongoDB Database", schemaKey: "rds" },
    { category: "Database", value: "Redis Cache", label: "Redis Cache", schemaKey: "cache" },
    { category: "Database", value: "MariaDB Database", label: "MariaDB Database", schemaKey: "rds" },
    { category: "Storage", value: "Block Storage Volume", label: "Block Storage Volume", schemaKey: "volume" },
    { category: "Storage", value: "Object Storage (S3-compatible)", label: "Object Storage (S3-compatible)", schemaKey: "s3" },
    { category: "Storage", value: "File Storage / NFS", label: "File Storage / NFS", schemaKey: "cloud_generic" },
    { category: "Storage", value: "CDP — Continuous Data Protection", label: "CDP — Continuous Data Protection", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Snapshot / Backup", label: "Snapshot / Backup", schemaKey: "cloud_generic" },
    { category: "Networking", value: "Load Balancer", label: "Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "Virtual Private Cloud", label: "Virtual Private Cloud", schemaKey: "vpc" },
    { category: "Networking", value: "Subnet", label: "Subnet", schemaKey: "subnet" },
    { category: "Networking", value: "Security Group / Firewall", label: "Security Group / Firewall", schemaKey: "sg" },
    { category: "Networking", value: "Public IP", label: "Public IP", schemaKey: "eip" },
    { category: "Networking", value: "Private Network", label: "Private Network", schemaKey: "vpc" },
    { category: "Networking", value: "VPN Gateway", label: "VPN Gateway", schemaKey: "cloud_generic" },
    { category: "Networking", value: "DNS Zone", label: "DNS Zone", schemaKey: "dns" },
    { category: "Networking", value: "CDN", label: "CDN", schemaKey: "cdn" },
    { category: "Other", value: "Monitoring / Alerts", label: "Monitoring / Alerts", schemaKey: "cloud_generic" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "other_custom" },
  ],
  "Oracle Cloud": [
    { category: "Compute", value: "Compute Instance", label: "Compute Instance", schemaKey: "vm" },
    { category: "Compute", value: "Functions", label: "Functions", schemaKey: "lambda" },
    { category: "Compute", value: "OKE — Kubernetes", label: "OKE — Kubernetes", schemaKey: "k8s" },
    { category: "Compute", value: "Container Instances", label: "Container Instances", schemaKey: "k8s" },
    { category: "Compute", value: "Bare Metal", label: "Bare Metal", schemaKey: "vm" },
    { category: "Database", value: "Autonomous Database", label: "Autonomous Database", schemaKey: "rds" },
    { category: "Database", value: "DB System", label: "DB System", schemaKey: "rds" },
    { category: "Database", value: "MySQL HeatWave", label: "MySQL HeatWave", schemaKey: "rds" },
    { category: "Database", value: "NoSQL Database", label: "NoSQL Database", schemaKey: "cloud_generic" },
    { category: "Database", value: "Cache with Redis", label: "Cache with Redis", schemaKey: "cache" },
    { category: "Storage", value: "Object Storage", label: "Object Storage", schemaKey: "s3" },
    { category: "Storage", value: "Block Volume", label: "Block Volume", schemaKey: "volume" },
    { category: "Storage", value: "File Storage", label: "File Storage", schemaKey: "cloud_generic" },
    { category: "Storage", value: "Archive Storage", label: "Archive Storage", schemaKey: "s3" },
    { category: "Networking", value: "VCN", label: "VCN", schemaKey: "vpc" },
    { category: "Networking", value: "Subnet", label: "Subnet", schemaKey: "subnet" },
    { category: "Networking", value: "Security List / NSG", label: "Security List / NSG", schemaKey: "sg" },
    { category: "Networking", value: "Load Balancer", label: "Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "Network Load Balancer", label: "Network Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "NAT Gateway", label: "NAT Gateway", schemaKey: "nat" },
    { category: "Networking", value: "Public IP", label: "Public IP", schemaKey: "eip" },
    { category: "Networking", value: "DNS", label: "DNS", schemaKey: "dns" },
    { category: "Networking", value: "API Gateway", label: "API Gateway", schemaKey: "cloud_generic" },
    { category: "Security", value: "Vault / KMS", label: "Vault / KMS", schemaKey: "cloud_generic" },
    { category: "Security", value: "IAM", label: "IAM", schemaKey: "cloud_generic" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "other_custom" },
  ],
  DigitalOcean: [
    { category: "Compute", value: "Droplet", label: "Droplet", schemaKey: "vm" },
    { category: "Compute", value: "Kubernetes (DOKS)", label: "Kubernetes (DOKS)", schemaKey: "k8s" },
    { category: "Compute", value: "App Platform", label: "App Platform", schemaKey: "cloud_generic" },
    { category: "Compute", value: "Functions", label: "Functions", schemaKey: "lambda" },
    { category: "Compute", value: "GPU Droplet", label: "GPU Droplet", schemaKey: "vm" },
    { category: "Database", value: "Managed Database", label: "Managed Database", schemaKey: "rds" },
    { category: "Database", value: "Managed Redis", label: "Managed Redis", schemaKey: "cache" },
    { category: "Database", value: "Managed MongoDB", label: "Managed MongoDB", schemaKey: "rds" },
    { category: "Storage", value: "Spaces", label: "Spaces", schemaKey: "s3" },
    { category: "Storage", value: "Volumes", label: "Volumes", schemaKey: "volume" },
    { category: "Storage", value: "Snapshots / Backups", label: "Snapshots / Backups", schemaKey: "cloud_generic" },
    { category: "Networking", value: "VPC", label: "VPC", schemaKey: "vpc" },
    { category: "Networking", value: "Firewall", label: "Firewall", schemaKey: "sg" },
    { category: "Networking", value: "Load Balancer", label: "Load Balancer", schemaKey: "lb" },
    { category: "Networking", value: "Reserved IP", label: "Reserved IP", schemaKey: "eip" },
    { category: "Networking", value: "CDN", label: "CDN", schemaKey: "cdn" },
    { category: "Networking", value: "DNS", label: "DNS", schemaKey: "dns" },
    { category: "Other", value: "Container Registry", label: "Container Registry", schemaKey: "cloud_generic" },
    { category: "Other", value: "Monitoring", label: "Monitoring", schemaKey: "cloud_generic" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "other_custom" },
  ],
  Atlassian: [
    { category: "SaaS", value: "Jira Software Cloud", label: "Jira Software Cloud", schemaKey: "jira" },
    { category: "SaaS", value: "Jira Work Management", label: "Jira Work Management", schemaKey: "jira" },
    { category: "SaaS", value: "Jira Service Management", label: "Jira Service Management", schemaKey: "jira" },
    { category: "SaaS", value: "Jira Product Discovery", label: "Jira Product Discovery", schemaKey: "jira" },
    { category: "SaaS", value: "Confluence Cloud", label: "Confluence Cloud", schemaKey: "jira" },
    { category: "SaaS", value: "Bitbucket Cloud", label: "Bitbucket Cloud", schemaKey: "jira" },
    { category: "SaaS", value: "Trello", label: "Trello", schemaKey: "jira" },
    { category: "SaaS", value: "Statuspage", label: "Statuspage", schemaKey: "license" },
    { category: "SaaS", value: "Opsgenie", label: "Opsgenie", schemaKey: "license" },
    { category: "SaaS", value: "Atlas", label: "Atlas", schemaKey: "license" },
    { category: "SaaS", value: "User License (per seat)", label: "User License (per seat)", schemaKey: "license" },
    { category: "SaaS", value: "Marketplace App / Plugin", label: "Marketplace App / Plugin", schemaKey: "license" },
    { category: "SaaS", value: "Storage Add-on", label: "Storage Add-on", schemaKey: "license" },
    { category: "SaaS", value: "Automation / Rules quota", label: "Automation / Rules quota", schemaKey: "license" },
    { category: "SaaS", value: "Premium / Enterprise Support", label: "Premium / Enterprise Support", schemaKey: "license" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
  Jira: [
    { category: "SaaS", value: "Jira Cloud — Site Subscription", label: "Jira Cloud — Site Subscription", schemaKey: "jira" },
    { category: "SaaS", value: "Jira Software Cloud", label: "Jira Software Cloud", schemaKey: "jira" },
    { category: "SaaS", value: "Jira Service Management", label: "Jira Service Management", schemaKey: "jira" },
    { category: "SaaS", value: "Confluence", label: "Confluence", schemaKey: "jira" },
    { category: "SaaS", value: "User License (per seat)", label: "User License (per seat)", schemaKey: "license" },
    { category: "SaaS", value: "Marketplace App / Plugin", label: "Marketplace App / Plugin", schemaKey: "license" },
    { category: "SaaS", value: "Storage Add-on", label: "Storage Add-on", schemaKey: "license" },
    { category: "SaaS", value: "Automation / Rules quota", label: "Automation / Rules quota", schemaKey: "license" },
    { category: "SaaS", value: "Premium / Enterprise Support", label: "Premium / Enterprise Support", schemaKey: "license" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
  GitHub: [
    { category: "SaaS", value: "GitHub Team / Enterprise seats", label: "GitHub Team / Enterprise seats", schemaKey: "seats" },
    { category: "SaaS", value: "Copilot Business — per user", label: "Copilot Business — per user", schemaKey: "seats" },
    { category: "SaaS", value: "Copilot Enterprise — per user", label: "Copilot Enterprise — per user", schemaKey: "seats" },
    { category: "SaaS", value: "Copilot Individual", label: "Copilot Individual", schemaKey: "seats" },
    { category: "SaaS", value: "GitHub Actions — CI/CD minutes", label: "GitHub Actions — CI/CD minutes", schemaKey: "license" },
    { category: "SaaS", value: "GitHub Packages — storage", label: "GitHub Packages — storage", schemaKey: "license" },
    { category: "SaaS", value: "GitHub Codespaces", label: "GitHub Codespaces", schemaKey: "seats" },
    { category: "SaaS", value: "GitHub Advanced Security", label: "GitHub Advanced Security", schemaKey: "license" },
    { category: "SaaS", value: "Large File Storage (LFS)", label: "Large File Storage (LFS)", schemaKey: "license" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
  "GitHub Copilot": [
    { category: "SaaS", value: "Copilot Business — per user", label: "Copilot Business — per user", schemaKey: "seats" },
    { category: "SaaS", value: "Copilot Enterprise — per user", label: "Copilot Enterprise — per user", schemaKey: "seats" },
    { category: "SaaS", value: "Copilot Individual", label: "Copilot Individual", schemaKey: "seats" },
    { category: "SaaS", value: "GitHub Actions — CI/CD minutes", label: "GitHub Actions — CI/CD minutes", schemaKey: "license" },
    { category: "SaaS", value: "GitHub Packages — storage", label: "GitHub Packages — storage", schemaKey: "license" },
    { category: "SaaS", value: "GitHub Codespaces", label: "GitHub Codespaces", schemaKey: "seats" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
  "Microsoft 365": [
    { category: "SaaS", value: "Microsoft 365 Business", label: "Microsoft 365 Business", schemaKey: "seats" },
    { category: "SaaS", value: "Microsoft 365 E3 / E5", label: "Microsoft 365 E3 / E5", schemaKey: "seats" },
    { category: "SaaS", value: "Exchange Online", label: "Exchange Online", schemaKey: "seats" },
    { category: "SaaS", value: "SharePoint Online", label: "SharePoint Online", schemaKey: "seats" },
    { category: "SaaS", value: "Teams", label: "Teams", schemaKey: "seats" },
    { category: "SaaS", value: "OneDrive", label: "OneDrive", schemaKey: "license" },
    { category: "SaaS", value: "Power BI Pro / Premium", label: "Power BI Pro / Premium", schemaKey: "seats" },
    { category: "SaaS", value: "Power Automate / Apps", label: "Power Automate / Apps", schemaKey: "license" },
    { category: "SaaS", value: "Visio / Project Online", label: "Visio / Project Online", schemaKey: "seats" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
  Datadog: [
    { category: "SaaS", value: "Infrastructure Monitoring hosts", label: "Infrastructure Monitoring hosts", schemaKey: "seats" },
    { category: "SaaS", value: "APM — hosts / spans", label: "APM — hosts / spans", schemaKey: "license" },
    { category: "SaaS", value: "Logs — indexed / ingested", label: "Logs — indexed / ingested", schemaKey: "license" },
    { category: "SaaS", value: "RUM — sessions", label: "RUM — sessions", schemaKey: "license" },
    { category: "SaaS", value: "Synthetics", label: "Synthetics", schemaKey: "license" },
    { category: "SaaS", value: "Security Monitoring", label: "Security Monitoring", schemaKey: "license" },
    { category: "SaaS", value: "Continuous Profiler", label: "Continuous Profiler", schemaKey: "license" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
  "Custom / Other": [
    { category: "SaaS", value: "SaaS workspace", label: "SaaS workspace", schemaKey: "jira" },
    { category: "SaaS", value: "AI / LLM seats", label: "AI / LLM seats", schemaKey: "seats" },
    { category: "SaaS", value: "License / seats", label: "License / seats", schemaKey: "license" },
    { category: "SaaS", value: "Subscription", label: "Subscription", schemaKey: "license" },
    { category: "SaaS", value: "Slack / Teams workspace", label: "Slack / Teams workspace", schemaKey: "seats" },
    { category: "SaaS", value: "Zoom / meeting seats", label: "Zoom / meeting seats", schemaKey: "seats" },
    { category: "SaaS", value: "Notion / wiki seats", label: "Notion / wiki seats", schemaKey: "seats" },
    { category: "SaaS", value: "Figma / design seats", label: "Figma / design seats", schemaKey: "seats" },
    { category: "Tools", value: "Dev tool / IDE", label: "Dev tool / IDE", schemaKey: "license" },
    { category: "Tools", value: "Monitoring / APM", label: "Monitoring / APM", schemaKey: "license" },
    { category: "Tools", value: "Security / scanning tool", label: "Security / scanning tool", schemaKey: "license" },
    { category: "Tools", value: "CI/CD platform", label: "CI/CD platform", schemaKey: "license" },
    { category: "Other", value: "Custom resource", label: "Custom resource", schemaKey: "custom" },
    { category: "Other", value: "Other / Custom service", label: "Other / Custom service", schemaKey: "custom" },
  ],
};

/** Map common billing / UI labels onto a SERVICES_BY_PROVIDER key. */
export function resolveProviderCatalogKey(provider: string): string {
  const raw = provider.trim();
  if (!raw) return "Custom / Other";
  if (SERVICES_BY_PROVIDER[raw]) return raw;
  const lower = raw.toLowerCase();
  if (lower === "aws" || lower.includes("amazon web services")) return "AWS";
  if (lower.includes("azure") || lower.includes("microsoft azure")) return "Microsoft Azure";
  if (lower === "gcp" || lower.includes("google cloud")) return "GCP";
  if (lower.includes("e2e")) return "E2E Cloud";
  if (lower.includes("oracle")) return "Oracle Cloud";
  if (lower.includes("digitalocean") || lower === "do") return "DigitalOcean";
  if (lower.includes("atlassian") || lower.includes("confluence") || lower.includes("bitbucket")) {
    return "Atlassian";
  }
  if (lower === "jira") return "Jira";
  if (lower.includes("copilot")) return "GitHub Copilot";
  if (lower.includes("github")) return "GitHub";
  if (lower.includes("microsoft 365") || lower.includes("office 365") || lower === "m365") {
    return "Microsoft 365";
  }
  if (lower.includes("datadog")) return "Datadog";
  return "Custom / Other";
}

export function servicesForProvider(provider: string): ServiceOption[] {
  const key = resolveProviderCatalogKey(provider);
  return SERVICES_BY_PROVIDER[key] ?? SERVICES_BY_PROVIDER["Custom / Other"];
}

/** Group services under category headers (Compute, Database, Networking, SaaS, …). */
export function servicesGroupedForProvider(
  provider: string
): { category: string; services: ServiceOption[] }[] {
  const list = servicesForProvider(provider);
  const order: string[] = [];
  const map = new Map<string, ServiceOption[]>();
  for (const s of list) {
    if (!map.has(s.category)) {
      order.push(s.category);
      map.set(s.category, []);
    }
    map.get(s.category)!.push(s);
  }
  return order.map((category) => ({ category, services: map.get(category)! }));
}

export function schemaKeyForService(provider: string, serviceValue: string): string {
  // Always use the rich “other” form for catch-all service picks.
  if (/^other\s*\/\s*custom/i.test(serviceValue.trim()) || /^custom resource$/i.test(serviceValue.trim())) {
    return "other_custom";
  }
  const svc = servicesForProvider(provider).find((s) => s.value === serviceValue);
  return svc?.schemaKey ?? "other_custom";
}

export function fieldsForService(provider: string, serviceValue: string): ResourceFieldDef[] {
  const key = schemaKeyForService(provider, serviceValue);
  return SCHEMA_FIELDS[key] ?? CUSTOM_FIELDS;
}

export function requiredAttributeKeys(provider: string, serviceValue: string): string[] {
  return fieldsForService(provider, serviceValue)
    .filter((f) => f.required)
    .map((f) => f.key);
}

export function isCloudProvider(provider: string): boolean {
  const key = resolveProviderCatalogKey(provider);
  return ![
    "Jira",
    "Atlassian",
    "GitHub",
    "GitHub Copilot",
    "Microsoft 365",
    "Datadog",
    "Custom / Other",
  ].includes(key);
}

/** Table summary line. */
export function summarizeAttributes(
  typeLabel: string | null | undefined,
  attrs: Record<string, unknown> | null | undefined,
  opts?: { skipProvider?: boolean; skipType?: boolean }
): string {
  if (!attrs) return "—";
  const parts: string[] = [];
  const provider = attrs.provider ?? attrs.cloud;
  if (!opts?.skipProvider && provider) parts.push(String(provider));
  if (!opts?.skipType && typeLabel) parts.push(typeLabel);

  if (attrs.custom_service_name) parts.push(String(attrs.custom_service_name));
  if (attrs.instance_type) parts.push(String(attrs.instance_type));
  if (attrs.region) parts.push(String(attrs.region));
  if (attrs.environment) parts.push(String(attrs.environment));
  if (attrs.seats != null) {
    const unit = attrs.seat_unit ? String(attrs.seat_unit) : "seats";
    parts.push(`${attrs.seats} ${unit}`);
  }
  if (attrs.engine) parts.push(String(attrs.engine));
  if (attrs.cidr_block) parts.push(String(attrs.cidr_block));
  if (attrs.plan) parts.push(String(attrs.plan));

  return parts.length ? parts.join(" · ") : "—";
}

export function resourceCloudLabel(
  attrs: Record<string, unknown> | null | undefined
): string | null {
  if (!attrs) return null;
  const v = attrs.provider ?? attrs.cloud;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

// --- Back-compat helpers used by older tests / call sites ---
export type SourceKind = "cloud" | "tool";

export function normalizeTypeKey(typeLabel: string): string | null {
  const n = typeLabel.trim().toLowerCase();
  if (n.includes("ec2") || n.includes("virtual server") || n.includes("droplet") || n.includes("compute"))
    return "ec2";
  if (n.includes("rds") || n.includes("database") || n.includes("sql")) return "rds";
  if (n.includes("vpc") || n.includes("vnet")) return "vpc";
  if (n.includes("s3") || n.includes("storage") || n.includes("blob") || n.includes("spaces")) return "s3";
  if (n.includes("copilot") || n.includes("seat")) return "seats";
  if (n.includes("jira") || n.includes("confluence")) return "jira";
  return null;
}

/** @deprecated prefer fieldsForService(provider, service) */
export function fieldsForResourceType(typeLabel: string, _sourceKind?: SourceKind): ResourceFieldDef[] {
  const key = normalizeTypeKey(typeLabel);
  if (key && SCHEMA_FIELDS[key]) return SCHEMA_FIELDS[key];
  return CUSTOM_FIELDS;
}
