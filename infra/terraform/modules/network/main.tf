terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  # Two AZs is the minimum RDS accepts for a subnet group. It is not a
  # high-availability claim: the database itself is single-AZ for staging.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.common_tags, { Name = local.name_prefix })
}

# Public subnets exist only to host the NAT gateway. Nothing is placed in them.
resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.cidr_block, 4, count.index)

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-public-${count.index}" })
}

resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.cidr_block, 4, count.index + length(local.azs))

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-private-${count.index}" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(var.common_tags, { Name = local.name_prefix })
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-nat" })
}

/*
 * The NAT gateway is the one unavoidable standing cost in this design, and it is
 * worth being explicit about why it exists.
 *
 * App Runner egress is all-or-nothing: either the default public path, with no
 * VPC and therefore no route to a private RDS instance, or VPC egress, in which
 * case *all* outbound traffic leaves through the VPC and reaching the internet
 * needs a NAT. The API needs both — the database (private) and the email
 * provider's HTTPS API (internet) — so VPC egress plus NAT is the shape that
 * works.
 *
 * The alternatives were considered and rejected: a publicly accessible RDS
 * instance cannot be restricted by security group to App Runner's default
 * egress, which has no stable addresses. Switching the email provider to SES
 * would allow a VPC endpoint instead of a NAT, which is a genuine argument for
 * SES at production scale — recorded in ADR-0018 rather than silently assumed
 * away here.
 *
 * A single NAT gateway, not one per AZ: staging does not need the second one,
 * and it would double this line item.
 */
resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.this]

  tags = merge(var.common_tags, { Name = local.name_prefix })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-public" })
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-private" })
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# The application's egress identity. The database security group accepts traffic
# from this and from nothing else.
resource "aws_security_group" "application" {
  name        = "${local.name_prefix}-application"
  description = "Falcon API egress"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "All outbound; reaching the database and the email provider"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-application" })
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-database"
  description = "Falcon PostgreSQL"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-database" })
}

# Written as a separate rule rather than an inline ingress block so the two
# security groups can reference each other without a cycle.
resource "aws_vpc_security_group_ingress_rule" "database_from_application" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the API only"
  referenced_security_group_id = aws_security_group.application.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"

  tags = var.common_tags
}
