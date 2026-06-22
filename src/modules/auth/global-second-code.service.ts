import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { AppSetting, AppSettingDocument } from './schemas/app-setting.schema';

const SETTING_KEY = 'global_second_code_hash';
const BCRYPT_ROUNDS = 12;

@Injectable()
export class GlobalSecondCodeService implements OnModuleInit {
  constructor(
    @InjectModel(AppSetting.name)
    private readonly settingModel: Model<AppSettingDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const existing = await this.getStoredHash();
    if (existing) {
      return;
    }

    const fromEnv = this.configService
      .get<string>('adminOverrideCode', '')
      .trim();

    if (fromEnv.length >= 4) {
      await this.saveHash(await bcrypt.hash(fromEnv, BCRYPT_ROUNDS));
    }
  }

  private async getStoredHash(): Promise<string | null> {
    const doc = await this.settingModel.findOne({ key: SETTING_KEY }).lean().exec();
    const value = doc?.value?.trim();
    return value || null;
  }

  private async saveHash(hash: string): Promise<void> {
    await this.settingModel
      .findOneAndUpdate(
        { key: SETTING_KEY },
        { $set: { value: hash } },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();
  }

  async hasCode(): Promise<boolean> {
    return Boolean(await this.getStoredHash());
  }

  async validate(plainCode: string): Promise<boolean> {
    const normalized = plainCode.trim();
    if (normalized.length < 4) {
      return false;
    }

    const hash = await this.getStoredHash();
    if (!hash) {
      return false;
    }

    return bcrypt.compare(normalized, hash);
  }

  async updateCode(plainCode: string): Promise<void> {
    const normalized = plainCode.trim();
    if (normalized.length < 4) {
      throw new Error('CODE_TOO_SHORT');
    }

    await this.saveHash(await bcrypt.hash(normalized, BCRYPT_ROUNDS));
  }
}
