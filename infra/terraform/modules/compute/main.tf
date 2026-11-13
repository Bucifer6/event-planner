# Compute for "one web service, one worker" (Q7): ONE Docker host that runs the release as
# containers (web, worker, static public site) behind an ingress that ends TLS for the three
# host names. This is the reference target "ssh-docker" of scripts/deploy/*.sh; the files it
# runs are in infra/reference-docker-host/.
#
# Secrets: the host has NO secret in its image, user data or disk template. Its role may read
# exactly one secret; `render-env` fetches it at start and before every release switch and
# writes app.env with mode 0600 (SEC13: injected from the secret store, by reference).

data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${var.name}-host"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "host" {
  statement {
    sid       = "ReadTheApplicationSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.app_secret_arn]
  }

  statement {
    sid       = "DecryptTheApplicationSecret"
    actions   = ["kms:Decrypt"]
    resources = [var.secrets_kms_key_arn]
  }

  statement {
    sid       = "ObjectsReadWrite"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = [for arn in var.object_bucket_arns : "${arn}/*"]
  }

  statement {
    sid       = "ObjectsList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = var.object_bucket_arns
  }

  statement {
    sid       = "ObjectsKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.objects_kms_key_arn]
  }

  # Backups: write and read (the restore test), never delete — expiry is the bucket's rule.
  statement {
    sid       = "BackupsWriteAndRead"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${var.backup_bucket_arn}/*"]
  }

  statement {
    sid       = "BackupsList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [var.backup_bucket_arn]
  }

  statement {
    sid       = "BackupsKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.backups_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "host" {
  name   = "${var.name}-host"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

# Shell access for operators without opening SSH (audited sessions through the provider).
resource "aws_iam_role_policy_attachment" "session_manager" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.name}-host"
  role = aws_iam_role.host.name
}

resource "aws_instance" "host" {
  ami                    = data.aws_ssm_parameter.ami.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.security_group_id]
  iam_instance_profile   = aws_iam_instance_profile.host.name

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    region                 = var.region
    deploy_dir             = var.deploy_dir
    deploy_ssh_public_key  = var.deploy_ssh_public_key
    docker_compose_version = var.docker_compose_version
    app_secret_arn         = var.app_secret_arn
    app_host               = var.app_host
    media_host             = var.media_host
    public_host            = var.public_host
    acme_email             = var.acme_email
  })

  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.disk_gb
    encrypted   = true
  }

  tags = {
    Name = "${var.name}-host"
  }

  lifecycle {
    # a newer base image or a changed bootstrap script must not replace a running host by
    # surprise; replace it on purpose (terraform apply -replace=…)
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "host" {
  instance = aws_instance.host.id
  domain   = "vpc"

  tags = {
    Name = "${var.name}-host"
  }
}
