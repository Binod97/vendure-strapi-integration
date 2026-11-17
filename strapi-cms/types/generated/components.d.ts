import type { Schema, Struct } from '@strapi/strapi';

export interface ProductSeo extends Struct.ComponentSchema {
  collectionName: 'components_product_seos';
  info: {
    displayName: 'SEO';
  };
  attributes: {
    canonicalUrl: Schema.Attribute.String;
    metaDescription: Schema.Attribute.Text;
    metaTitle: Schema.Attribute.String;
  };
}

export interface ProductSpecification extends Struct.ComponentSchema {
  collectionName: 'components_product_specifications';
  info: {
    displayName: 'Specification';
  };
  attributes: {
    key: Schema.Attribute.String;
    value: Schema.Attribute.String;
  };
}

export interface ProductVariant extends Struct.ComponentSchema {
  collectionName: 'components_product_variants';
  info: {
    displayName: 'Variant';
  };
  attributes: {
    label: Schema.Attribute.String;
    sku: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'product.seo': ProductSeo;
      'product.specification': ProductSpecification;
      'product.variant': ProductVariant;
    }
  }
}
