# U6 Spike — RDS reachability over a Tailscale subnet router (throwaway, official template)

**Goal:** before plan 003 (`docs/plans/2026-06-14-003-feat-tailscale-private-aws-access-plan.md`) builds anything, use Tailscale's **official CloudFormation quick-create** to stand up a throwaway subnet router and answer:

1. Does the bare template's router **forward subnet traffic** (i.e., is `net.ipv4.ip_forward` on after install, or does it need manual enabling)? — this decides whether "just use the template" extends to the production router.
2. Can a laptop reach RDS **by `*.rds.amazonaws.com` hostname** through the route (via split-DNS), or only by private IP?
3. Is the RDS private IP stable enough to map?

**Safety:** launches a real EC2 (via the template) and temporarily opens a DB security group. Run each phase with `!`, read output, and run **Phase 6 teardown** when done. Prefer a **sandbox** target if one exists.

---

## Phase 0 — Prerequisites

- **Revoke the auth key that leaked in the pasted console URL first** (admin console → Settings → Keys → revoke `kRGgYJrh7H11CNTRL`).
- Generate a **fresh reusable, ephemeral** auth key (admin console → Settings → Keys; short expiry).
- Laptop on the tailnet (`tailscale status`); AWS CLI authenticated.

```bash
! export TS_AUTHKEY='tskey-auth-FRESH-KEY'
! export AWS_REGION=us-east-1   # adjust
```

---

## Phase 1 — Pick the target VPC / RDS

```bash
! aws rds describe-db-instances --region "$AWS_REGION" \
    --query "DBInstances[?contains(DBInstanceIdentifier,'identity')].{Id:DBInstanceIdentifier,Endpoint:Endpoint.Address,Port:Endpoint.Port,VpcSG:VpcSecurityGroups[0].VpcSecurityGroupId,Vpc:DBSubnetGroup.VpcId}" \
    --output table
```

```bash
! export RDS_ENDPOINT='<Endpoint>'; export RDS_PORT='<Port>'; export DB_SG='<VpcSG>'; export VPC_ID='<Vpc>'
! aws ec2 describe-vpcs --vpc-ids "$VPC_ID" --region "$AWS_REGION" --query 'Vpcs[0].CidrBlock'
! aws ec2 describe-subnets --region "$AWS_REGION" --filters "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[].{Id:SubnetId,Cidr:CidrBlock,Public:MapPublicIpOnLaunch}' --output table
! export VPC_CIDR='<CidrBlock>'; export SUBNET='<a subnet in this VPC with egress>'; export VPC_RESOLVER='10.0.0.2'  # VPC base +2
```

---

## Phase 2 — Launch via Tailscale's quick-create template

Look up an Ubuntu 24.04 AMI for your region (the template's default AMI is region-pinned), then create the stack:

```bash
! export AMI=$(aws ssm get-parameter --region "$AWS_REGION" \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)
! echo "AMI=$AMI"

! aws cloudformation create-stack --region "$AWS_REGION" \
    --stack-name ts-spike \
    --template-url https://tailscale-cloudformation-templates.s3.amazonaws.com/single_instance_stack_v2.yml \
    --parameters \
      ParameterKey=AuthKey,ParameterValue="$TS_AUTHKEY" \
      ParameterKey=ExtraArgs,ParameterValue="--advertise-routes=$VPC_CIDR --accept-dns=false --ssh" \
      ParameterKey=Hostname,ParameterValue=ts-spike \
      ParameterKey=ImageId,ParameterValue="$AMI" \
      ParameterKey=InstanceType,ParameterValue=t3.small \
      ParameterKey=VpcId,ParameterValue="$VPC_ID" \
      ParameterKey=VpcSubnetId,ParameterValue="$SUBNET"

! aws cloudformation wait stack-create-complete --region "$AWS_REGION" --stack-name ts-spike
! tailscale status | grep ts-spike
```

**Approve the route (manual):** admin console → Machines → `ts-spike` → Review subnet routes → enable the advertised CIDR.

---

## Phase 3 — Answer the IP-forwarding question (the production-decisive check)

```bash
! tailscale ssh ts-spike 'sysctl net.ipv4.ip_forward'
```

- If it returns `net.ipv4.ip_forward = 1` → the template forwards out of the box. **Record this — it means the template is viable for the production router too.**
- If `= 0` → the bare template does NOT forward; enable it manually and record that production would need this step on every instance:
    ```bash
    ! tailscale ssh ts-spike 'echo net.ipv4.ip_forward=1 | sudo tee /etc/sysctl.d/99-ts.conf && sudo sysctl -p /etc/sysctl.d/99-ts.conf'
    ```

---

## Phase 4 — Open the DB to the router, configure split-DNS, test

Get the SG the template created, then allow it into the RDS (reversible):

```bash
! export ROUTER_SG=$(aws cloudformation describe-stack-resources --region "$AWS_REGION" \
    --stack-name ts-spike --query "StackResources[?ResourceType=='AWS::EC2::SecurityGroup'].PhysicalResourceId" --output text)
! echo "ROUTER_SG=$ROUTER_SG"
! aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
    --group-id "$DB_SG" --protocol tcp --port "$RDS_PORT" --source-group "$ROUTER_SG"
```

**Split-DNS (manual, admin console):** DNS → add nameserver `$VPC_RESOLVER` with a restricted search domain of `<region>.rds.amazonaws.com`.

```bash
! aws secretsmanager get-secret-value --region "$AWS_REGION" \
    --secret-id 'kitchensink/<stage>/identity/keys' --query SecretString --output text
! export PGPASSWORD='<password field>'
```

**Test 1 — by hostname (the R3/R5 question):**

```bash
! psql "host=$RDS_ENDPOINT port=$RDS_PORT user=identity_app dbname=kitchensink_identity sslmode=require" -c '\dt'
```

**Test 2 — by private IP (routing-works proof if DNS fails):**

```bash
! tailscale ssh ts-spike "getent hosts $RDS_ENDPOINT"   # note the 10.0.x.x it returns
! export RDS_IP='<that IP>'
! psql "host=$RDS_IP port=$RDS_PORT user=identity_app dbname=kitchensink_identity sslmode=require" -c '\dt'
```

---

## Phase 5 — Record the decision (the U6 deliverable)

Into the plan-003 ADR stub:

- **Did forwarding need manual enabling?** → decides whether the production router can be the bare template or needs a forwarding hook.
- **Hostname (Test 1) vs IP (Test 2):** if hostname works via split-DNS, R3/R5 stand; if only IP works, decide the DNS arrangement or amend R3/R5.
- **RDS IP stability** across failover (affects whether an IP mapping rots).

---

## Phase 6 — Teardown (run when done)

```bash
! aws ec2 revoke-security-group-ingress --region "$AWS_REGION" \
    --group-id "$DB_SG" --protocol tcp --port "$RDS_PORT" --source-group "$ROUTER_SG"
! aws cloudformation delete-stack --region "$AWS_REGION" --stack-name ts-spike
! aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name ts-spike
```

Then in the admin console: remove the split-DNS nameserver, remove the `ts-spike` machine, and revoke the auth key. Confirm `tailscale status` no longer lists `ts-spike`.
