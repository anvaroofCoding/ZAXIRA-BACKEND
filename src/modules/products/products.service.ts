import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { PurchaseRequestStatus } from '../purchase-requests/enums/purchase-request-status.enum';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
} from '../purchase-requests/schemas/purchase-request.schema';
import { UsersService } from '../users/users.service';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import {
  hasPageAccess,
  hasPageAction,
  normalizePermissions,
} from '../users/utils/permissions.util';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from '../warehouse/schemas/warehouse-inventory.schema';
import { buildWarehouseItemKey } from '../warehouse/utils/item-key.util';
import { computeWarehouseBarcode } from '../warehouse/utils/warehouse-barcode.util';
import { QueryProductsDto, SearchProductsDto } from './dto/query-products.dto';
import {
  PRODUCTS_PAGE_PATH,
  PURCHASE_REQUEST_SUBMIT_PATH,
} from './products.constants';
import {
  ProductArchive,
  ProductArchiveDocument,
} from './schemas/product-archive.schema';

export interface ProductCatalogRow {
  itemKey: string;
  name: string;
  characteristics: string;
  barcode: string;
  nomenclatureCode: string;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(PurchaseRequest.name)
    private readonly purchaseRequestModel: Model<PurchaseRequestDocument>,
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(ProductArchive.name)
    private readonly archiveModel: Model<ProductArchiveDocument>,
    private readonly usersService: UsersService,
  ) {}

  private async getUserPermissions(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return {
        isSuperAdmin: true,
        permissions: null as UserPermissionsMap | null,
      };
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      return { isSuperAdmin: false, permissions: null };
    }

    return {
      isSuperAdmin: false,
      permissions: normalizePermissions(
        user.permissions as UserPermissionsMap | undefined,
      ),
    };
  }

  private async assertPageAccess(userId: string, role?: UserRole) {
    const { isSuperAdmin, permissions } = await this.getUserPermissions(
      userId,
      role,
    );
    if (isSuperAdmin) {
      return;
    }

    if (
      !permissions ||
      !hasPageAccess(permissions, PRODUCTS_PAGE_PATH, false)
    ) {
      throw new ForbiddenException('Maxsulotlar sahifasiga ruxsat yo‘q');
    }
  }

  private async assertSearchAccess(userId: string, role?: UserRole) {
    const { isSuperAdmin, permissions } = await this.getUserPermissions(
      userId,
      role,
    );
    if (isSuperAdmin) {
      return;
    }

    if (!permissions) {
      throw new ForbiddenException('Qidiruv uchun ruxsat yo‘q');
    }

    const canSearchProducts = hasPageAccess(
      permissions,
      PRODUCTS_PAGE_PATH,
      false,
    );
    const canSubmitRequest = hasPageAction(
      permissions,
      PURCHASE_REQUEST_SUBMIT_PATH,
      'create',
      false,
    );

    if (!canSearchProducts && !canSubmitRequest) {
      throw new ForbiddenException('Qidiruv uchun ruxsat yo‘q');
    }
  }

  private async assertArchivePermission(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Maxsulotni arxivlash huquqi yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    if (!hasPageAction(permissions, PRODUCTS_PAGE_PATH, 'delete', false)) {
      throw new ForbiddenException('Maxsulotni arxivlash huquqi yo‘q');
    }
  }

  private async loadArchivedKeys(): Promise<Set<string>> {
    const rows = await this.archiveModel.find().select('itemKey').lean().exec();
    return new Set(rows.map((row) => row.itemKey));
  }

  private async buildCatalogRows(): Promise<ProductCatalogRow[]> {
    const completedItems = await this.purchaseRequestModel
      .aggregate<{
        name: string;
        characteristics: string;
      }>([
        { $match: { status: PurchaseRequestStatus.WAREHOUSE_COMPLETED } },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              name: { $trim: { input: '$items.name' } },
              characteristics: { $trim: { input: '$items.characteristics' } },
            },
          },
        },
        {
          $project: {
            _id: 0,
            name: '$_id.name',
            characteristics: '$_id.characteristics',
          },
        },
      ])
      .exec();

    if (!completedItems.length) {
      return [];
    }

    const archivedKeys = await this.loadArchivedKeys();
    const itemKeys = completedItems.map((item) =>
      buildWarehouseItemKey(item.name, item.characteristics),
    );

    const inventoryRows = await this.inventoryModel
      .aggregate<{
        _id: string;
        barcode?: string;
        nomenclatureCode?: string;
      }>([
        { $match: { itemKey: { $in: itemKeys } } },
        {
          $group: {
            _id: '$itemKey',
            barcode: { $first: { $ifNull: ['$barcode', null] } },
            nomenclatureCode: {
              $first: { $ifNull: ['$receiptNomenclatureCode', null] },
            },
          },
        },
      ])
      .exec();

    const inventoryByKey = new Map(
      inventoryRows.map((row) => [
        row._id,
        {
          barcode: row.barcode?.trim() || '',
          nomenclatureCode: row.nomenclatureCode?.trim() || '',
        },
      ]),
    );

    const unique = new Map<string, ProductCatalogRow>();

    for (const item of completedItems) {
      const name = String(item.name ?? '').trim();
      const characteristics = String(item.characteristics ?? '').trim();
      if (!name) continue;

      const itemKey = buildWarehouseItemKey(name, characteristics);
      if (archivedKeys.has(itemKey) || unique.has(itemKey)) {
        continue;
      }

      const inventoryMeta = inventoryByKey.get(itemKey);
      const barcode =
        inventoryMeta?.barcode || computeWarehouseBarcode(name, characteristics);

      unique.set(itemKey, {
        itemKey,
        name,
        characteristics,
        barcode,
        nomenclatureCode: inventoryMeta?.nomenclatureCode || '',
      });
    }

    return Array.from(unique.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'uz'),
    );
  }

  private filterRows(rows: ProductCatalogRow[], search?: string) {
    const query = search?.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter((row) => {
      const haystack =
        `${row.name} ${row.characteristics} ${row.barcode} ${row.nomenclatureCode}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  async list(dto: QueryProductsDto, userId: string, role?: UserRole) {
    await this.assertPageAccess(userId, role);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;
    const allRows = this.filterRows(await this.buildCatalogRows(), dto.search);
    const total = allRows.length;
    const start = (page - 1) * limit;
    const items = allRows.slice(start, start + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async search(dto: SearchProductsDto, userId: string, role?: UserRole) {
    await this.assertSearchAccess(userId, role);

    const limit = dto.limit ?? 20;
    const query = dto.q?.trim().toLowerCase() ?? '';
    const rows = await this.buildCatalogRows();

    if (!query) {
      return rows.slice(0, limit);
    }

    return rows
      .filter((row) => {
        const haystack = `${row.name} ${row.characteristics}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, limit);
  }

  async archive(itemKey: string, userId: string, role?: UserRole) {
    await this.assertArchivePermission(userId, role);

    const normalizedKey = itemKey?.trim();
    if (!normalizedKey) {
      throw new NotFoundException('Maxsulot topilmadi');
    }

    const catalog = await this.buildCatalogRows();
    const exists = catalog.some((row) => row.itemKey === normalizedKey);
    if (!exists) {
      const alreadyArchived = await this.archiveModel
        .findOne({ itemKey: normalizedKey })
        .lean()
        .exec();
      if (alreadyArchived) {
        return { archived: true, itemKey: normalizedKey };
      }
      throw new NotFoundException('Maxsulot topilmadi');
    }

    await this.archiveModel
      .findOneAndUpdate(
        { itemKey: normalizedKey },
        { itemKey: normalizedKey, archivedById: userId },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return { archived: true, itemKey: normalizedKey };
  }
}
