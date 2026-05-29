import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByLoginWithPassword(dto.login);

    if (!user) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    const isValid = await this.usersService.validatePassword(
      dto.password,
      user.passwordHash,
    );

    if (!isValid) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    const payload: JwtPayload = {
      sub: user.id,
      login: user.login,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const profileUser = await this.usersService.findByIdWithStructure(user.id);

    return {
      accessToken,
      user: this.usersService.getAuthProfile(profileUser ?? user),
    };
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findByIdWithStructure(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi');
    }

    return this.usersService.getAuthProfile(user);
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.usersService.updateOwnProfile(userId, dto);
  }

  changePassword(userId: string, dto: ChangePasswordDto) {
    return this.usersService.changeOwnPassword(userId, dto);
  }
}
