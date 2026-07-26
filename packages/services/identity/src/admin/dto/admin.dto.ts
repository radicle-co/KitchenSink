import { IsString } from 'class-validator';

export class AdminUserIdParamDto {
    @IsString()
    userId!: string;
}

export class AdminSuspendUserResponseDto {
    sub!: string;
    status!: 'suspended';
    suspendedAt!: string;
}

export class AdminUnsuspendUserResponseDto {
    sub!: string;
    status!: 'active';
    unsuspendedAt!: string;
}

export class AdminReactivateUserResponseDto {
    sub!: string;
    status!: 'active';
    reactivatedAt!: string;
}

export class ImpersonationStartResponseDto {
    impersonatorSub!: string;
    impersonatedSub!: string;
    sessionId!: string;
    startedAt!: string;
}

export class ImpersonationStopResponseDto {
    impersonatorSub!: string;
    impersonatedSub!: string;
    stoppedAt!: string;
    message!: string;
}

export class AdminAuditLogDto {
    readonly impersonatorSub!: string;
    readonly impersonatedSub!: string;
    readonly action!: string;
    readonly timestamp!: string;
    readonly success!: boolean;
    readonly failureReason?: string;
}
