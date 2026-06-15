import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class PagePermissionActionsSchema {
  @Prop({ default: false })
  create!: boolean;

  @Prop({ default: false })
  update!: boolean;

  @Prop({ default: false })
  delete!: boolean;
}

export const PagePermissionActionsSchemaFactory = SchemaFactory.createForClass(
  PagePermissionActionsSchema,
);

@Schema({ _id: false })
export class PagePermissionSchema {
  @Prop({ default: false })
  access!: boolean;

  @Prop({ type: PagePermissionActionsSchemaFactory, default: () => ({}) })
  actions!: PagePermissionActionsSchema;
}

export const PagePermissionSchemaFactory =
  SchemaFactory.createForClass(PagePermissionSchema);
